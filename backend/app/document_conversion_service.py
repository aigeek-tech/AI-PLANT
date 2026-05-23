from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
from threading import Lock, Thread
from uuid import uuid4
import zipfile

from psycopg import IntegrityError

from .document_conversion_repository import (
    claim_next_document_conversion_job,
    ensure_document_conversion_job,
    list_document_conversion_jobs,
    mark_document_conversion_job_completed,
    mark_document_conversion_job_failed,
    retry_document_conversion_job,
)
from .document_conversion_validation import (
    cross_check_conversion_summaries,
    summarize_rvm_file,
    validate_gaussian_splat_ply,
    validate_spark_rad_file,
)
from .document_repository import create_project_document_file_record, get_project_document_file
from .document_repository import list_project_document_revision_files
from .document_storage import get_document_storage, resolve_preview_mode
from .document_visualization_repository import (
    create_document_visualization,
    get_document_visualization_by_preview,
    replace_document_visualization_assets,
)
from .settings.config import get_settings


logger = logging.getLogger(__name__)

RVM_EXTENSIONS = frozenset({"rvm"})
VUE_EXTENSIONS = frozenset({"vue"})
RADC_EXTENSIONS = frozenset({"radc"})
SPARK_PREVIEW_EXTENSIONS = frozenset({"ply", "spz", "splat", "ksplat", "sog", "zip", "rad"})
SPARK_ASSET_EXTENSIONS = SPARK_PREVIEW_EXTENSIONS | RADC_EXTENSIONS
CONVERSION_OUTPUT_CONTENT_TYPE = "application/octet-stream"
RAD_BUNDLE_ZIP_MAX_ENTRIES = 2048
RAD_BUNDLE_ZIP_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024

_active_conversion_threads: set[str] = set()
_active_conversion_threads_lock = Lock()


def file_extension(filename: str) -> str:
    if "." not in filename.strip("."):
        return ""
    return filename.rsplit(".", 1)[1].strip().lower()


def is_spark_preview_filename(filename: str) -> bool:
    return file_extension(filename) in SPARK_PREVIEW_EXTENSIONS


def is_spark_asset_filename(filename: str) -> bool:
    return file_extension(filename) in SPARK_ASSET_EXTENSIONS


def is_rvm_filename(filename: str) -> bool:
    return file_extension(filename) in RVM_EXTENSIONS


def is_vue_filename(filename: str) -> bool:
    return file_extension(filename) in VUE_EXTENSIONS


def list_conversion_jobs_for_revision(project_id: str, document_id: str, revision_id: str) -> list[dict]:
    return list_document_conversion_jobs(project_id, document_id, revision_id)


def create_conversion_job_for_file(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
) -> dict:
    settings = get_settings().document_conversion
    if not settings.enabled:
        raise ValueError("Document conversion is disabled")

    file_row = get_project_document_file(project_id, document_id, revision_id, file_id)
    if file_row is None:
        raise ValueError("File not found")
    if file_row["status"] != "ready":
        raise ValueError("File is not ready for conversion")

    extension = file_extension(file_row["original_filename"])
    if extension not in RVM_EXTENSIONS:
        raise ValueError("Only RVM files can be converted automatically")
    if int(file_row["size_bytes"] or 0) > settings.max_bytes:
        raise ValueError(f"File must be {settings.max_bytes} bytes or smaller for conversion")

    job = ensure_document_conversion_job(
        project_id,
        document_id,
        revision_id,
        file_id,
        input_format=extension,
        output_format="rad",
        metadata={"source_file_name": file_row["original_filename"]},
    )
    schedule_queued_conversion_jobs()
    return job


def retry_conversion_job_for_revision(project_id: str, document_id: str, revision_id: str, job_id: str) -> dict:
    settings = get_settings().document_conversion
    if not settings.enabled:
        raise ValueError("Document conversion is disabled")

    job = retry_document_conversion_job(project_id, document_id, revision_id, job_id)
    if job is None:
        raise ValueError("Conversion job not found or is not retryable")
    schedule_queued_conversion_jobs()
    return job


def handle_uploaded_document_file(project_id: str, document_id: str, revision_id: str, file_row: dict) -> None:
    filename = str(file_row.get("original_filename") or "")
    extension = file_extension(filename)
    if extension in RADC_EXTENSIONS:
        _try_register_revision_rad_visualizations(project_id, document_id, revision_id)
        return
    if extension in SPARK_PREVIEW_EXTENSIONS:
        _ensure_self_spark_visualization(project_id, document_id, revision_id, file_row)
        if extension == "rad":
            _try_register_revision_rad_visualizations(project_id, document_id, revision_id)
        return
    if is_rvm_filename(filename):
        try:
            create_conversion_job_for_file(project_id, document_id, revision_id, str(file_row["id"]))
        except Exception as error:
            logger.warning("Failed to enqueue RVM conversion for file %s: %s", file_row.get("id"), error)


def schedule_queued_conversion_jobs() -> None:
    settings = get_settings().document_conversion
    if not _can_run_conversion_in_current_process(settings):
        return

    with _active_conversion_threads_lock:
        if _active_conversion_threads:
            return

        job = claim_next_document_conversion_job()
        if job is None:
            return

        job_id = str(job["id"])
        _active_conversion_threads.add(job_id)
        thread = Thread(target=_run_claimed_conversion_job, args=(job,), daemon=True)
        thread.start()


def run_conversion_worker_forever(*, poll_seconds: float = 2.0) -> None:
    import time

    while True:
        processed = run_one_queued_conversion_job()
        if not processed:
            time.sleep(poll_seconds)


def run_one_queued_conversion_job() -> bool:
    if not get_settings().document_conversion.enabled:
        return False
    job = claim_next_document_conversion_job()
    if job is None:
        return False
    _run_conversion_job(job)
    return True


def _run_claimed_conversion_job(job: dict) -> None:
    job_id = str(job["id"])
    try:
        _run_conversion_job(job)
    finally:
        with _active_conversion_threads_lock:
            _active_conversion_threads.discard(job_id)
        schedule_queued_conversion_jobs()


def _run_conversion_job(job: dict) -> None:
    job_id = str(job["id"])
    try:
        metadata = _convert_rvm_job(job)
        mark_document_conversion_job_completed(job_id, metadata["output_file_id"], metadata)
    except Exception as error:
        message = str(error) or error.__class__.__name__
        mark_document_conversion_job_failed(job_id, message, {"error_type": error.__class__.__name__})
        logger.warning("Document conversion job %s failed: %s", job_id, message)


def _convert_rvm_job(job: dict) -> dict:
    settings = get_settings().document_conversion
    if str(job.get("input_format") or "").lower() != "rvm":
        raise ValueError("Only RVM conversion jobs are supported")
    if not settings.rvm_converter_command:
        raise RuntimeError("RVM_CONVERTER_COMMAND is not configured")
    if not settings.spark_build_lod_command:
        raise RuntimeError("SPARK_BUILD_LOD_COMMAND is not configured")

    project_id = str(job["project_id"])
    document_id = str(job["document_id"])
    revision_id = str(job["revision_id"])
    source_file_id = str(job["source_file_id"])
    source_file = get_project_document_file(project_id, document_id, revision_id, source_file_id)
    if source_file is None:
        raise ValueError("Source file not found")
    if source_file["status"] != "ready":
        raise ValueError("Source file is not ready")
    if not is_rvm_filename(source_file["original_filename"]):
        raise ValueError("Source file is not an RVM model")
    if int(source_file["size_bytes"] or 0) > settings.max_bytes:
        raise ValueError(f"File must be {settings.max_bytes} bytes or smaller for conversion")

    storage = get_document_storage()
    workdir = Path(settings.workdir) / str(job["id"])
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    source_path = workdir / "source.rvm"
    splat_ply_path = workdir / "source-splats.ply"
    rad_path = workdir / "source-lod.rad"

    try:
        source_bytes = storage.get_object_bytes(object_key=source_file["object_key"])
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        source_path.write_bytes(source_bytes)
        rvm_summary = summarize_rvm_file(source_path)

        _run_command_template(
            settings.rvm_converter_command,
            input_path=source_path,
            output_path=splat_ply_path,
            workdir=workdir,
        )
        _require_non_empty_file(splat_ply_path, "RVM converter did not create a splat PLY")
        ply_summary = validate_gaussian_splat_ply(splat_ply_path)

        _run_command_template(
            settings.spark_build_lod_command,
            input_path=splat_ply_path,
            output_path=rad_path,
            workdir=workdir,
        )
        rad_path = _resolve_rad_output_path(rad_path, splat_ply_path, workdir)
        _require_non_empty_file(rad_path, "Spark build-lod command did not create a RAD file")
        rad_summary = validate_spark_rad_file(rad_path)
        validation_warnings = cross_check_conversion_summaries(ply_summary, rad_summary)

        rad_bytes = rad_path.read_bytes()
        rad_sha256 = hashlib.sha256(rad_bytes).hexdigest()
        output_file_id = str(uuid4())
        output_filename = f"{Path(source_file['original_filename']).stem}.rad"
        output_object_key = storage.build_object_key(
            project_id=project_id,
            document_id=document_id,
            revision_id=revision_id,
            file_id=output_file_id,
            filename=output_filename,
        )
        storage.put_object(
            object_key=output_object_key,
            content=rad_bytes,
            content_type=CONVERSION_OUTPUT_CONTENT_TYPE,
        )
        output_file = create_project_document_file_record(
            project_id,
            document_id,
            revision_id,
            {
                "id": output_file_id,
                "file_role": "reference",
                "original_filename": output_filename,
                "relative_path": None,
                "storage_provider": storage.provider,
                "bucket": storage.config.bucket,
                "object_key": output_object_key,
                "mime_type": CONVERSION_OUTPUT_CONTENT_TYPE,
                "size_bytes": len(rad_bytes),
                "checksum_sha256": rad_sha256,
                "preview_mode": resolve_preview_mode(output_filename, CONVERSION_OUTPUT_CONTENT_TYPE),
                "status": "ready",
            },
        )
        if output_file is None:
            raise RuntimeError("Failed to create generated RAD file record")

        visualization = _ensure_visualization(project_id, document_id, revision_id, source_file_id, output_file_id, {
            "units": "m",
            "conversion": {
                "source_format": "rvm",
                "output_format": "rad",
                "mode": "geometric_splat",
                "source_sha256": source_sha256,
                "output_sha256": rad_sha256,
                "validation": {
                    "rvm": rvm_summary,
                    "ply": ply_summary,
                    "rad": rad_summary,
                    "warnings": validation_warnings,
                },
            },
        })
        if visualization is None:
            raise RuntimeError("Failed to create Spark visualization record")
        visualization_assets = _store_rad_visualization_assets(
            project_id,
            document_id,
            revision_id,
            str(visualization["id"]),
            output_file,
            rad_summary,
            workdir,
            storage,
        )

        return {
            "source_file_id": source_file_id,
            "source_file_name": source_file["original_filename"],
            "source_sha256": source_sha256,
            "output_file_id": output_file_id,
            "output_file_name": output_filename,
            "output_size_bytes": len(rad_bytes),
            "output_object_key": output_object_key,
            "output_sha256": rad_sha256,
            "validation": {
                "rvm": rvm_summary,
                "ply": ply_summary,
                "rad": rad_summary,
                "warnings": validation_warnings,
            },
            "visualization_assets": visualization_assets,
            "commands": {
                "rvm_converter_configured": True,
                "spark_build_lod_configured": True,
                "rad_path": str(rad_path),
            },
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _ensure_self_spark_visualization(project_id: str, document_id: str, revision_id: str, file_row: dict) -> None:
    try:
        extension = file_extension(str(file_row.get("original_filename") or ""))
        if extension == "zip" and _try_register_rad_bundle_zip(project_id, document_id, revision_id, file_row):
            return
        if extension == "rad":
            storage = get_document_storage()
            rad_bytes = storage.get_object_bytes(object_key=file_row["object_key"])
            workdir = Path(get_settings().document_conversion.workdir) / "direct-rad-validation" / str(file_row["id"])
            if workdir.exists():
                shutil.rmtree(workdir)
            workdir.mkdir(parents=True, exist_ok=True)
            try:
                rad_path = workdir / str(file_row["original_filename"])
                rad_path.write_bytes(rad_bytes)
                rad_summary = validate_spark_rad_file(rad_path)
                if rad_summary["external_chunks"]:
                    _ensure_chunked_rad_visualization(project_id, document_id, revision_id, file_row, rad_summary)
                    return
                _ensure_embedded_rad_visualization(project_id, document_id, revision_id, file_row, rad_path, rad_summary, storage)
                return
            finally:
                shutil.rmtree(workdir, ignore_errors=True)

        visualization = _ensure_visualization(
            project_id,
            document_id,
            revision_id,
            str(file_row["id"]),
            str(file_row["id"]),
            {"units": "m", "source": "direct_spark_asset"},
        )
        if visualization is not None:
            _replace_direct_visualization_assets(project_id, str(visualization["id"]), file_row, [])
    except Exception as error:
        logger.warning("Failed to auto-register Spark visualization for file %s: %s", file_row.get("id"), error)


def _try_register_rad_bundle_zip(project_id: str, document_id: str, revision_id: str, file_row: dict) -> bool:
    storage = get_document_storage()
    zip_bytes = storage.get_object_bytes(object_key=file_row["object_key"])
    workdir = Path(get_settings().document_conversion.workdir) / "direct-rad-bundle" / str(file_row["id"])
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        zip_path = workdir / "bundle.zip"
        zip_path.write_bytes(zip_bytes)
        with zipfile.ZipFile(zip_path) as archive:
            members = _validate_rad_bundle_zip_members(archive)
            rad_members = [member for member in members if file_extension(Path(member.filename).name) == "rad"]
            if len(rad_members) != 1:
                return False

            rad_member = rad_members[0]
            rad_filename = Path(rad_member.filename).name
            rad_path = workdir / rad_filename
            rad_path.write_bytes(archive.read(rad_member))
            rad_summary = validate_spark_rad_file(rad_path)
            if not rad_summary["external_chunks"]:
                _ensure_embedded_rad_visualization(project_id, document_id, revision_id, file_row, rad_path, rad_summary, storage)
                return True

            member_by_name = {Path(member.filename).name: member for member in members}
            missing = [
                str(chunk["filename"])
                for chunk in rad_summary.get("external_chunk_files") or []
                if str(chunk["filename"]) not in member_by_name
            ]
            if missing:
                logger.info("RAD bundle zip %s is missing chunks: %s", file_row.get("id"), ", ".join(missing))
                return True

            visualization = _ensure_visualization(
                project_id,
                document_id,
                revision_id,
                str(file_row["id"]),
                str(file_row["id"]),
                {
                    "units": "m",
                    "source": "zip_rad_bundle",
                    "rad": {"chunk_count": len(rad_summary.get("external_chunk_files") or []), "missing_chunks": []},
                },
            )
            if visualization is None:
                return True

            assets = [
                _upload_visualization_asset_bytes(
                    project_id,
                    document_id,
                    revision_id,
                    rad_filename,
                    rad_path.read_bytes(),
                    storage,
                    "header",
                )
            ]
            for chunk in rad_summary.get("external_chunk_files") or []:
                chunk_filename = str(chunk["filename"])
                chunk_bytes = archive.read(member_by_name[chunk_filename])
                assets.append(
                    _upload_visualization_asset_bytes(
                        project_id,
                        document_id,
                        revision_id,
                        chunk_filename,
                        chunk_bytes,
                        storage,
                        "chunk",
                    )
                )
            replace_document_visualization_assets(project_id, str(visualization["id"]), assets)
            return True
    except zipfile.BadZipFile:
        logger.info("Spark zip file %s is not a RAD bundle zip", file_row.get("id"))
        return False
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _validate_rad_bundle_zip_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = [member for member in archive.infolist() if not member.is_dir()]
    if len(members) > RAD_BUNDLE_ZIP_MAX_ENTRIES:
        raise ValueError("RAD bundle zip contains too many files")

    total_size = 0
    for member in members:
        filename = member.filename.replace("\\", "/")
        path = Path(filename)
        if filename.startswith("/") or path.is_absolute() or ".." in path.parts:
            raise ValueError("RAD bundle zip contains an unsafe path")
        basename = path.name
        if not basename or "/" in basename or "\\" in basename:
            raise ValueError("RAD bundle zip filename is invalid")
        extension = file_extension(basename)
        if extension not in {"rad", "radc"}:
            raise ValueError("RAD bundle zip can only contain .rad and .radc files")
        total_size += int(member.file_size or 0)
        if total_size > RAD_BUNDLE_ZIP_MAX_UNCOMPRESSED_BYTES:
            raise ValueError("RAD bundle zip is too large after extraction")
    return members


def _ensure_embedded_rad_visualization(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_row: dict,
    rad_path: Path,
    rad_summary: dict,
    storage,
) -> None:
    meta, chunks_start = _read_rad_metadata(rad_path)
    if any("filename" in chunk for chunk in meta["chunks"]):
        return

    visualization = _ensure_visualization(
        project_id,
        document_id,
        revision_id,
        str(file_row["id"]),
        str(file_row["id"]),
        {
            "units": "m",
            "source": "direct_embedded_rad_split",
            "rad": {
                "chunk_count": rad_summary["chunk_count"],
                "embedded_source_bytes": int(file_row.get("size_bytes") or rad_path.stat().st_size),
            },
        },
    )
    if visualization is None:
        return

    base_name = Path(str(file_row["original_filename"])).stem
    chunk_specs = _build_external_chunk_specs(meta, base_name)
    header_filename = str(file_row["original_filename"])
    header_bytes = _build_external_rad_header_bytes(meta, chunk_specs)
    assets = [
        _upload_visualization_asset_bytes(
            project_id,
            document_id,
            revision_id,
            header_filename,
            header_bytes,
            storage,
            "header",
        )
    ]

    with rad_path.open("rb") as source:
        for spec in chunk_specs:
            source.seek(chunks_start + spec["offset"])
            chunk_bytes = source.read(spec["bytes"])
            if len(chunk_bytes) != spec["bytes"] or chunk_bytes[:4] != b"RADC":
                raise RuntimeError(f"RAD chunk {spec['filename']} is invalid or truncated")
            assets.append(
                _upload_visualization_asset_bytes(
                    project_id,
                    document_id,
                    revision_id,
                    spec["filename"],
                    chunk_bytes,
                    storage,
                    "chunk",
                )
            )

    replace_document_visualization_assets(project_id, str(visualization["id"]), assets)


def _read_rad_metadata(rad_path: Path) -> tuple[dict, int]:
    with rad_path.open("rb") as file:
        header = file.read(8)
        if len(header) < 8 or header[:4] != b"RAD0":
            raise ValueError("RAD output is missing RAD0 magic")
        meta_length = int.from_bytes(header[4:8], "little")
        if meta_length <= 0:
            raise ValueError("RAD metadata header is invalid")
        meta_bytes = file.read(meta_length)
        if len(meta_bytes) != meta_length:
            raise ValueError("RAD metadata header is truncated")
    meta = json.loads(meta_bytes)
    chunks = meta.get("chunks")
    if not isinstance(chunks, list) or not chunks:
        raise ValueError("RAD metadata contains no chunks")
    return meta, 8 + _roundup8(meta_length)


def _build_external_chunk_specs(meta: dict, base_name: str) -> list[dict]:
    specs: list[dict] = []
    for index, chunk in enumerate(meta["chunks"]):
        offset = int(chunk.get("offset") or 0)
        byte_count = int(chunk.get("bytes") or 0)
        if offset < 0 or byte_count <= 0:
            raise ValueError("RAD embedded chunk range is invalid")
        specs.append({
            "filename": f"{base_name}-{index}.radc",
            "offset": offset,
            "bytes": byte_count,
        })
    return specs


def _build_external_rad_header_bytes(meta: dict, chunk_specs: list[dict]) -> bytes:
    next_meta = dict(meta)
    next_meta["chunks"] = [
        {"offset": spec["offset"], "bytes": spec["bytes"], "filename": spec["filename"]}
        for spec in chunk_specs
    ]
    meta_bytes = json.dumps(next_meta, separators=(",", ":")).encode("utf-8")
    return (
        b"RAD0"
        + len(meta_bytes).to_bytes(4, "little")
        + meta_bytes
        + (b"\x00" * (_roundup8(len(meta_bytes)) - len(meta_bytes)))
    )


def _upload_visualization_asset_bytes(
    project_id: str,
    document_id: str,
    revision_id: str,
    filename: str,
    content: bytes,
    storage,
    asset_role: str,
) -> dict:
    file_id = str(uuid4())
    object_key = storage.build_object_key(
        project_id=project_id,
        document_id=document_id,
        revision_id=revision_id,
        file_id=file_id,
        filename=filename,
    )
    storage.put_object(
        object_key=object_key,
        content=content,
        content_type=CONVERSION_OUTPUT_CONTENT_TYPE,
    )
    return {
        "asset_role": asset_role,
        "filename": filename,
        "storage_provider": storage.provider,
        "bucket": storage.config.bucket,
        "object_key": object_key,
        "mime_type": CONVERSION_OUTPUT_CONTENT_TYPE,
        "size_bytes": len(content),
        "checksum_sha256": hashlib.sha256(content).hexdigest(),
    }


def _ensure_visualization(
    project_id: str,
    document_id: str,
    revision_id: str,
    source_file_id: str,
    preview_file_id: str,
    metadata: dict,
) -> dict | None:
    try:
        return create_document_visualization(
            project_id,
            document_id,
            revision_id,
            {
                "source_file_id": source_file_id,
                "preview_file_id": preview_file_id,
                "annotation_manifest_file_id": None,
                "metadata": metadata,
            },
        )
    except IntegrityError:
        return get_document_visualization_by_preview(project_id, document_id, revision_id, preview_file_id)


def _try_register_revision_rad_visualizations(project_id: str, document_id: str, revision_id: str) -> None:
    for file_row in list_project_document_revision_files(project_id, document_id, revision_id):
        if file_row.get("status") == "ready" and file_extension(str(file_row.get("original_filename") or "")) == "rad":
            _ensure_self_spark_visualization(project_id, document_id, revision_id, file_row)


def _ensure_chunked_rad_visualization(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_row: dict,
    rad_summary: dict,
) -> None:
    chunk_names = [str(item["filename"]) for item in rad_summary.get("external_chunk_files") or []]
    ready_files = {
        str(item["original_filename"]): item
        for item in list_project_document_revision_files(project_id, document_id, revision_id)
        if item.get("status") == "ready"
    }
    missing = [name for name in chunk_names if name not in ready_files]
    if missing:
        logger.info("RAD file %s is waiting for missing chunks: %s", file_row.get("id"), ", ".join(missing))
        return

    visualization = _ensure_visualization(
        project_id,
        document_id,
        revision_id,
        str(file_row["id"]),
        str(file_row["id"]),
        {
            "units": "m",
            "source": "direct_chunked_rad",
            "rad": {"chunk_count": len(chunk_names), "missing_chunks": []},
        },
    )
    if visualization is None:
        return
    _replace_direct_visualization_assets(
        project_id,
        str(visualization["id"]),
        file_row,
        [ready_files[name] for name in chunk_names],
    )


def _replace_direct_visualization_assets(
    project_id: str,
    visualization_id: str,
    header_file: dict,
    chunk_files: list[dict],
) -> list[dict]:
    assets = [_document_file_to_visualization_asset(header_file, "header")]
    assets.extend(_document_file_to_visualization_asset(file_row, "chunk") for file_row in chunk_files)
    return replace_document_visualization_assets(project_id, visualization_id, assets)


def _document_file_to_visualization_asset(file_row: dict, asset_role: str) -> dict:
    return {
        "asset_role": asset_role,
        "filename": file_row["original_filename"],
        "storage_provider": file_row.get("storage_provider", "s3"),
        "bucket": file_row["bucket"],
        "object_key": file_row["object_key"],
        "mime_type": file_row["mime_type"],
        "size_bytes": file_row["size_bytes"],
        "checksum_sha256": file_row.get("checksum_sha256"),
    }


def _store_rad_visualization_assets(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    header_file: dict,
    rad_summary: dict,
    workdir: Path,
    storage,
) -> list[dict]:
    assets = [_document_file_to_visualization_asset(header_file, "header")]
    for chunk in rad_summary.get("external_chunk_files") or []:
        chunk_filename = str(chunk["filename"])
        chunk_path = workdir / chunk_filename
        _require_non_empty_file(chunk_path, f"Spark build-lod did not create RAD chunk {chunk_filename}")
        chunk_bytes = chunk_path.read_bytes()
        chunk_file_id = str(uuid4())
        chunk_object_key = storage.build_object_key(
            project_id=project_id,
            document_id=document_id,
            revision_id=revision_id,
            file_id=chunk_file_id,
            filename=chunk_filename,
        )
        storage.put_object(
            object_key=chunk_object_key,
            content=chunk_bytes,
            content_type=CONVERSION_OUTPUT_CONTENT_TYPE,
        )
        assets.append({
            "asset_role": "chunk",
            "filename": chunk_filename,
            "storage_provider": storage.provider,
            "bucket": storage.config.bucket,
            "object_key": chunk_object_key,
            "mime_type": CONVERSION_OUTPUT_CONTENT_TYPE,
            "size_bytes": len(chunk_bytes),
            "checksum_sha256": hashlib.sha256(chunk_bytes).hexdigest(),
        })
    return replace_document_visualization_assets(project_id, visualization_id, assets)


def _run_command_template(command_template: str, *, input_path: Path, output_path: Path, workdir: Path) -> None:
    command = command_template.format(
        input=_quote_path(str(input_path)),
        output=_quote_path(str(output_path)),
        workdir=_quote_path(str(workdir)),
    )
    completed = subprocess.run(
        command,
        cwd=workdir,
        shell=True,
        capture_output=True,
        text=True,
        timeout=get_settings().agent.job_timeout_seconds,
        check=False,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(stderr or f"Conversion command failed with exit code {completed.returncode}")


def _resolve_rad_output_path(expected_path: Path, splat_ply_path: Path, workdir: Path) -> Path:
    if expected_path.exists():
        return expected_path

    spark_default_path = splat_ply_path.with_name(f"{splat_ply_path.stem}-lod.rad")
    if spark_default_path.exists():
        return spark_default_path

    generated_rad_paths = sorted(workdir.glob("*.rad"))
    if len(generated_rad_paths) == 1:
        return generated_rad_paths[0]
    return expected_path


def _can_run_conversion_in_current_process(settings) -> bool:
    return bool(settings.enabled and settings.rvm_converter_command and settings.spark_build_lod_command)


def _quote_path(value: str) -> str:
    if os.name == "nt":
        return subprocess.list2cmdline([value])
    import shlex

    return shlex.quote(value)


def _require_non_empty_file(path: Path, message: str) -> None:
    if not path.exists() or path.stat().st_size <= 0:
        raise RuntimeError(message)


def _roundup8(value: int) -> int:
    return (value + 7) & ~7


def describe_document_conversion_settings() -> dict:
    settings = get_settings().document_conversion
    payload = asdict(settings)
    payload["rvm_converter_command_configured"] = bool(settings.rvm_converter_command)
    payload["spark_build_lod_command_configured"] = bool(settings.spark_build_lod_command)
    payload.pop("rvm_converter_command", None)
    payload.pop("spark_build_lod_command", None)
    return payload
