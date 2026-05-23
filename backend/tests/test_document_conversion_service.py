import json
import io
import struct
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from app.document_conversion_service import (
    create_conversion_job_for_file,
    handle_uploaded_document_file,
    is_spark_preview_filename,
    is_vue_filename,
    run_one_queued_conversion_job,
    schedule_queued_conversion_jobs,
)
from app.document_conversion_validation import (
    summarize_rvm_file,
    validate_gaussian_splat_ply,
    validate_spark_rad_file,
)


def _be_u32(value: int) -> bytes:
    return struct.pack(">I", value)


def _be_f32_values(values: list[float]) -> bytes:
    return b"".join(struct.pack(">f", value) for value in values)


def _rvm_string(value: str) -> bytes:
    raw = value.encode("utf-8") + b"\x00"
    units = max(1, (len(raw) + 3) // 4)
    return _be_u32(units) + raw.ljust(units * 4, b"\x00")


def _rvm_chunk(name: str, payload: bytes, start_offset: int) -> bytes:
    encoded_name = b"".join(b"\x00\x00\x00" + bytes([ord(char)]) for char in name)
    next_offset = start_offset + 24 + len(payload)
    return encoded_name + _be_u32(next_offset) + _be_u32(1) + payload


def _valid_rvm_bytes() -> bytes:
    chunks: list[bytes] = []
    offset = 0

    def append_chunk(name: str, payload: bytes) -> None:
        nonlocal offset
        chunk = _rvm_chunk(name, payload, offset)
        chunks.append(chunk)
        offset += len(chunk)

    append_chunk(
        "HEAD",
        _be_u32(1)
        + _rvm_string("VANTAGE PDMS Design")
        + _rvm_string("fixture")
        + _rvm_string("Sat Jan 01 00:00:00 2000")
        + _rvm_string("tester"),
    )
    append_chunk("MODL", _be_u32(1) + _rvm_string("project") + _rvm_string("model"))
    append_chunk("CNTB", _be_u32(1) + _rvm_string("/ROOT") + _be_f32_values([0, 0, 0]) + _be_u32(1))
    matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    bbox = [-1, -1, -1, 1, 1, 1]
    append_chunk("PRIM", _be_u32(1) + _be_u32(8) + _be_f32_values(matrix + bbox + [0.5, 2.0]))
    append_chunk("CNTE", _be_u32(1))
    append_chunk("END:", b"")
    return b"".join(chunks)


def _valid_gaussian_ply_bytes(vertex_count: int = 1) -> bytes:
    properties = [
        "x",
        "y",
        "z",
        "f_dc_0",
        "f_dc_1",
        "f_dc_2",
        "opacity",
        "scale_0",
        "scale_1",
        "scale_2",
        "rot_0",
        "rot_1",
        "rot_2",
        "rot_3",
    ]
    header = [
        "ply",
        "format ascii 1.0",
        f"element vertex {vertex_count}",
        *[f"property float {name}" for name in properties],
        "end_header",
    ]
    row = "0 0 0 0.5 0.5 0.5 1 0.1 0.1 0.1 0 0 0 1"
    return ("\n".join(header + [row for _index in range(vertex_count)]) + "\n").encode("ascii")


def _roundup8(value: int) -> int:
    return (value + 7) & ~7


def _valid_rad_bytes(input_splat_count: int = 1, final_splat_count: int = 1) -> bytes:
    payload = b"12345678"
    properties = [
        {"offset": 0, "bytes": 1, "property": "center", "encoding": "f32"},
        {"offset": 1, "bytes": 1, "property": "alpha", "encoding": "r8"},
        {"offset": 2, "bytes": 1, "property": "rgb", "encoding": "r8"},
        {"offset": 3, "bytes": 1, "property": "scales", "encoding": "ln_0r8"},
        {"offset": 4, "bytes": 1, "property": "orientation", "encoding": "oct88r8"},
    ]
    chunk_meta = {
        "version": 1,
        "base": 0,
        "count": final_splat_count,
        "payloadBytes": len(payload),
        "properties": properties,
    }
    chunk_meta_bytes = json.dumps(chunk_meta, separators=(",", ":")).encode("utf-8")
    chunk = (
        b"RADC"
        + len(chunk_meta_bytes).to_bytes(4, "little")
        + chunk_meta_bytes
        + (b"\x00" * (_roundup8(len(chunk_meta_bytes)) - len(chunk_meta_bytes)))
        + len(payload).to_bytes(8, "little")
        + payload
    )
    rad_meta = {
        "version": 1,
        "type": "gsplat",
        "count": final_splat_count,
        "maxSh": 0,
        "chunkSize": 65536,
        "allChunkBytes": len(chunk),
        "chunks": [{"offset": 0, "bytes": len(chunk)}],
        "comment": json.dumps({
            "input_splat_count": input_splat_count,
            "final_splat_count": final_splat_count,
        }),
    }
    rad_meta_bytes = json.dumps(rad_meta, separators=(",", ":")).encode("utf-8")
    return (
        b"RAD0"
        + len(rad_meta_bytes).to_bytes(4, "little")
        + rad_meta_bytes
        + (b"\x00" * (_roundup8(len(rad_meta_bytes)) - len(rad_meta_bytes)))
        + chunk
    )


def _valid_external_rad_bytes(input_splat_count: int = 1, final_splat_count: int = 1) -> bytes:
    rad_meta = {
        "version": 1,
        "type": "gsplat",
        "count": final_splat_count,
        "maxSh": 0,
        "chunkSize": 65536,
        "allChunkBytes": 128,
        "chunks": [{"offset": 0, "filename": "source-splats-lod-0.radc", "bytes": 128}],
        "comment": json.dumps({
            "input_splat_count": input_splat_count,
            "final_splat_count": final_splat_count,
        }),
    }
    rad_meta_bytes = json.dumps(rad_meta, separators=(",", ":")).encode("utf-8")
    return (
        b"RAD0"
        + len(rad_meta_bytes).to_bytes(4, "little")
        + rad_meta_bytes
        + (b"\x00" * (_roundup8(len(rad_meta_bytes)) - len(rad_meta_bytes)))
    )


def _valid_radc_bytes() -> bytes:
    rad_bytes = _valid_rad_bytes()
    return rad_bytes[rad_bytes.index(b"RADC"):]


class DocumentConversionServiceTest(unittest.TestCase):
    def test_validates_rvm_ply_and_rad_artifacts(self):
        with TemporaryDirectory() as temp_dir:
            workdir = Path(temp_dir)
            rvm_path = workdir / "source.rvm"
            ply_path = workdir / "source-splats.ply"
            rad_path = workdir / "source-splats-lod.rad"
            rvm_path.write_bytes(_valid_rvm_bytes())
            ply_path.write_bytes(_valid_gaussian_ply_bytes())
            rad_path.write_bytes(_valid_rad_bytes())

            rvm_summary = summarize_rvm_file(rvm_path)
            ply_summary = validate_gaussian_splat_ply(ply_path)
            rad_summary = validate_spark_rad_file(rad_path)

        self.assertEqual(rvm_summary["geometry_count"], 1)
        self.assertEqual(rvm_summary["primitive_counts"]["cylinder"], 1)
        self.assertEqual(ply_summary["vertex_count"], 1)
        self.assertEqual(rad_summary["count"], 1)

    def test_detects_spark_and_vue_formats(self):
        self.assertTrue(is_spark_preview_filename("plant.rad"))
        self.assertTrue(is_spark_preview_filename("plant.ply"))
        self.assertTrue(is_vue_filename("plant.vue"))
        self.assertFalse(is_vue_filename("plant.rvm"))

    def test_enqueues_rvm_conversion_job_for_ready_file(self):
        with patch(
            "app.document_conversion_service.get_project_document_file",
            return_value={
                "id": "source-file",
                "original_filename": "plant.rvm",
                "status": "ready",
                "size_bytes": 1024,
            },
        ), patch(
            "app.document_conversion_service.ensure_document_conversion_job",
            return_value={"id": "job-1", "status": "queued"},
        ) as ensure_job, patch("app.document_conversion_service.schedule_queued_conversion_jobs") as schedule_jobs:
            result = create_conversion_job_for_file("project-1", "doc-1", "rev-1", "source-file")

        self.assertEqual(result["id"], "job-1")
        ensure_job.assert_called_once()
        self.assertEqual(ensure_job.call_args.kwargs["input_format"], "rvm")
        schedule_jobs.assert_called_once()

    def test_rejects_vue_conversion_job(self):
        with patch(
            "app.document_conversion_service.get_project_document_file",
            return_value={
                "id": "source-file",
                "original_filename": "plant.vue",
                "status": "ready",
                "size_bytes": 1024,
            },
        ):
            with self.assertRaisesRegex(ValueError, "Only RVM"):
                create_conversion_job_for_file("project-1", "doc-1", "rev-1", "source-file")

    def test_uploaded_spark_asset_registers_self_visualization(self):
        file_row = {
            "id": "spark-file",
            "original_filename": "plant.ply",
            "storage_provider": "s3",
            "bucket": "smart-design-documents",
            "object_key": "spark-key",
            "mime_type": "application/octet-stream",
            "size_bytes": 128,
        }

        with patch(
            "app.document_conversion_service.create_document_visualization",
            return_value={"id": "visualization-1"},
        ) as create_visualization, patch(
            "app.document_conversion_service.replace_document_visualization_assets"
        ) as replace_assets, patch(
            "app.document_conversion_service.list_project_document_revision_files",
            return_value=[],
        ):
            handle_uploaded_document_file("project-1", "doc-1", "rev-1", file_row)

        create_visualization.assert_called_once()
        replace_assets.assert_called_once()
        payload = create_visualization.call_args.args[3]
        self.assertEqual(payload["source_file_id"], "spark-file")
        self.assertEqual(payload["preview_file_id"], "spark-file")

    def test_uploaded_rvm_file_enqueues_conversion(self):
        file_row = {"id": "source-file", "original_filename": "plant.rvm"}

        with patch("app.document_conversion_service.create_conversion_job_for_file") as create_job:
            handle_uploaded_document_file("project-1", "doc-1", "rev-1", file_row)

        create_job.assert_called_once_with("project-1", "doc-1", "rev-1", "source-file")

    def test_uploaded_chunked_rad_waits_for_missing_radc(self):
        file_row = {
            "id": "rad-file",
            "original_filename": "plant.rad",
            "object_key": "rad-key",
            "storage_provider": "s3",
            "bucket": "smart-design-documents",
            "mime_type": "application/octet-stream",
            "size_bytes": len(_valid_external_rad_bytes()),
        }
        storage = Mock()
        storage.get_object_bytes.return_value = _valid_external_rad_bytes()

        with TemporaryDirectory() as temp_dir, patch(
            "app.document_conversion_service.get_document_storage",
            return_value=storage,
        ), patch(
            "app.document_conversion_service.get_settings"
        ) as get_settings, patch(
            "app.document_conversion_service.list_project_document_revision_files",
            return_value=[file_row],
        ), patch(
            "app.document_conversion_service.create_document_visualization"
        ) as create_visualization:
            settings = Mock()
            settings.document_conversion.workdir = temp_dir
            get_settings.return_value = settings

            handle_uploaded_document_file("project-1", "doc-1", "rev-1", file_row)

        create_visualization.assert_not_called()

    def test_uploaded_embedded_rad_splits_into_header_and_chunk_assets(self):
        rad_bytes = _valid_rad_bytes()
        file_row = {
            "id": "rad-file",
            "original_filename": "plant.rad",
            "object_key": "rad-key",
            "storage_provider": "s3",
            "bucket": "smart-design-documents",
            "mime_type": "application/octet-stream",
            "size_bytes": len(rad_bytes),
        }
        storage = Mock()
        storage.provider = "s3"
        storage.config.bucket = "smart-design-documents"
        storage.get_object_bytes.return_value = rad_bytes
        storage.build_object_key.side_effect = [
            "projects/project-1/documents/doc-1/revisions/rev-1/header-plant.rad",
            "projects/project-1/documents/doc-1/revisions/rev-1/chunk-plant-0.radc",
        ]

        with TemporaryDirectory() as temp_dir, patch(
            "app.document_conversion_service.get_document_storage",
            return_value=storage,
        ), patch(
            "app.document_conversion_service.get_settings"
        ) as get_settings, patch(
            "app.document_conversion_service.create_document_visualization",
            return_value={"id": "visualization-1"},
        ), patch(
            "app.document_conversion_service.replace_document_visualization_assets",
            side_effect=lambda _project_id, _visualization_id, assets: assets,
        ) as replace_assets, patch(
            "app.document_conversion_service.list_project_document_revision_files",
            return_value=[],
        ):
            settings = Mock()
            settings.document_conversion.workdir = temp_dir
            get_settings.return_value = settings

            handle_uploaded_document_file("project-1", "doc-1", "rev-1", file_row)

        self.assertEqual(storage.put_object.call_count, 2)
        header_put = storage.put_object.call_args_list[0].kwargs
        chunk_put = storage.put_object.call_args_list[1].kwargs
        self.assertLess(len(header_put["content"]), len(rad_bytes))
        self.assertTrue(header_put["content"].startswith(b"RAD0"))
        meta_length = int.from_bytes(header_put["content"][4:8], "little")
        header_meta = json.loads(header_put["content"][8:8 + meta_length])
        self.assertEqual(header_meta["chunks"][0]["offset"], 0)
        self.assertEqual(header_meta["chunks"][0]["filename"], "plant-0.radc")
        self.assertTrue(chunk_put["content"].startswith(b"RADC"))
        assets = replace_assets.call_args.args[2]
        self.assertEqual([asset["asset_role"] for asset in assets], ["header", "chunk"])
        self.assertEqual(assets[1]["filename"], "plant-0.radc")

    def test_uploaded_zip_rad_bundle_registers_header_and_chunks(self):
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as archive:
            archive.writestr("bundle/plant.rad", _valid_external_rad_bytes())
            archive.writestr("bundle/source-splats-lod-0.radc", _valid_radc_bytes()[:128])
        file_row = {
            "id": "zip-file",
            "original_filename": "plant-bundle.zip",
            "object_key": "zip-key",
            "storage_provider": "s3",
            "bucket": "smart-design-documents",
            "mime_type": "application/zip",
            "size_bytes": len(zip_buffer.getvalue()),
        }
        storage = Mock()
        storage.provider = "s3"
        storage.config.bucket = "smart-design-documents"
        storage.get_object_bytes.return_value = zip_buffer.getvalue()
        storage.build_object_key.side_effect = [
            "projects/project-1/documents/doc-1/revisions/rev-1/header-plant.rad",
            "projects/project-1/documents/doc-1/revisions/rev-1/chunk-source-splats-lod-0.radc",
        ]

        with TemporaryDirectory() as temp_dir, patch(
            "app.document_conversion_service.get_document_storage",
            return_value=storage,
        ), patch(
            "app.document_conversion_service.get_settings"
        ) as get_settings, patch(
            "app.document_conversion_service.create_document_visualization",
            return_value={"id": "visualization-1"},
        ), patch(
            "app.document_conversion_service.replace_document_visualization_assets",
            side_effect=lambda _project_id, _visualization_id, assets: assets,
        ) as replace_assets, patch(
            "app.document_conversion_service.list_project_document_revision_files",
            return_value=[],
        ):
            settings = Mock()
            settings.document_conversion.workdir = temp_dir
            get_settings.return_value = settings

            handle_uploaded_document_file("project-1", "doc-1", "rev-1", file_row)

        assets = replace_assets.call_args.args[2]
        self.assertEqual([asset["filename"] for asset in assets], ["plant.rad", "source-splats-lod-0.radc"])

    def test_rejects_unsafe_rad_bundle_zip_path(self):
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as archive:
            archive.writestr("../plant.rad", _valid_external_rad_bytes())
        file_row = {
            "id": "zip-file",
            "original_filename": "plant-bundle.zip",
            "object_key": "zip-key",
            "storage_provider": "s3",
            "bucket": "smart-design-documents",
            "mime_type": "application/zip",
            "size_bytes": len(zip_buffer.getvalue()),
        }
        storage = Mock()
        storage.get_object_bytes.return_value = zip_buffer.getvalue()

        with TemporaryDirectory() as temp_dir, patch(
            "app.document_conversion_service.get_document_storage",
            return_value=storage,
        ), patch(
            "app.document_conversion_service.get_settings"
        ) as get_settings, patch(
            "app.document_conversion_service.create_document_visualization"
        ) as create_visualization:
            settings = Mock()
            settings.document_conversion.workdir = temp_dir
            get_settings.return_value = settings

            handle_uploaded_document_file("project-1", "doc-1", "rev-1", file_row)

        create_visualization.assert_not_called()

    def test_api_process_does_not_claim_jobs_without_converter_commands(self):
        with patch("app.document_conversion_service.get_settings") as get_settings, patch(
            "app.document_conversion_service.claim_next_document_conversion_job"
        ) as claim_job:
            settings = Mock()
            settings.document_conversion.enabled = True
            settings.document_conversion.rvm_converter_command = None
            settings.document_conversion.spark_build_lod_command = None
            get_settings.return_value = settings

            schedule_queued_conversion_jobs()

        claim_job.assert_not_called()

    def test_worker_runs_configured_commands_and_creates_rad_asset(self):
        with TemporaryDirectory() as temp_dir:
            workdir = Path(temp_dir)
            ply_fixture = workdir / "fixture.ply"
            rad_fixture = workdir / "fixture.rad"
            ply_fixture.write_bytes(_valid_gaussian_ply_bytes())
            rad_fixture.write_bytes(_valid_rad_bytes())
            converter_script = workdir / "mock_converter.py"
            lod_script = workdir / "mock_lod.py"
            converter_script.write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "Path(sys.argv[2]).write_bytes(Path(sys.argv[3]).read_bytes())\n",
                encoding="utf-8",
            )
            lod_script.write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "Path(sys.argv[2]).write_bytes(Path(sys.argv[3]).read_bytes())\n",
                encoding="utf-8",
            )
            storage = Mock()
            storage.provider = "s3"
            storage.config.bucket = "smart-design-documents"
            storage.get_object_bytes.return_value = _valid_rvm_bytes()
            storage.build_object_key.return_value = "projects/project-1/documents/doc-1/revisions/rev-1/rad-file-plant.rad"

            with patch(
                "app.document_conversion_service.get_settings"
            ) as get_settings, patch(
                "app.document_conversion_service.claim_next_document_conversion_job",
                return_value={
                    "id": "job-1",
                    "project_id": "project-1",
                    "document_id": "doc-1",
                    "revision_id": "rev-1",
                    "source_file_id": "source-file",
                    "input_format": "rvm",
                },
            ), patch(
                "app.document_conversion_service.get_project_document_file",
                return_value={
                    "id": "source-file",
                    "original_filename": "plant.rvm",
                    "object_key": "source-key",
                    "status": "ready",
                    "size_bytes": 1024,
                },
            ), patch("app.document_conversion_service.get_document_storage", return_value=storage), patch(
                "app.document_conversion_service.create_project_document_file_record",
                return_value={
                    "id": "rad-file",
                    "original_filename": "plant.rad",
                    "storage_provider": "s3",
                    "bucket": "smart-design-documents",
                    "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/rad-file-plant.rad",
                    "mime_type": "application/octet-stream",
                    "size_bytes": len(_valid_rad_bytes()),
                },
            ) as create_file, patch(
                "app.document_conversion_service.create_document_visualization"
            ) as create_visualization, patch(
                "app.document_conversion_service.replace_document_visualization_assets",
                return_value=[{"filename": "plant.rad"}],
            ) as replace_assets, patch(
                "app.document_conversion_service.mark_document_conversion_job_completed"
            ) as mark_completed:
                settings = Mock()
                settings.document_conversion.enabled = True
                settings.document_conversion.max_bytes = 4096
                settings.document_conversion.workdir = str(workdir)
                settings.document_conversion.rvm_converter_command = (
                    f'python "{converter_script}" {{input}} {{output}} "{ply_fixture}"'
                )
                settings.document_conversion.spark_build_lod_command = (
                    f'python "{lod_script}" {{input}} {{output}} "{rad_fixture}"'
                )
                settings.agent.job_timeout_seconds = 30
                get_settings.return_value = settings

                self.assertTrue(run_one_queued_conversion_job())

        storage.put_object.assert_called_once()
        create_file.assert_called_once()
        create_visualization.assert_called_once()
        replace_assets.assert_called_once()
        mark_completed.assert_called_once()
        self.assertEqual(mark_completed.call_args.args[1], create_file.call_args.args[3]["id"])
        self.assertIsNotNone(create_file.call_args.args[3]["checksum_sha256"])
        self.assertEqual(mark_completed.call_args.args[2]["validation"]["ply"]["vertex_count"], 1)

    def test_worker_accepts_spark_default_rad_output_name(self):
        with TemporaryDirectory() as temp_dir:
            workdir = Path(temp_dir)
            ply_fixture = workdir / "fixture.ply"
            rad_fixture = workdir / "fixture.rad"
            ply_fixture.write_bytes(_valid_gaussian_ply_bytes())
            rad_fixture.write_bytes(_valid_rad_bytes())
            converter_script = workdir / "mock_converter.py"
            lod_script = workdir / "mock_lod_default.py"
            converter_script.write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "Path(sys.argv[2]).write_bytes(Path(sys.argv[3]).read_bytes())\n",
                encoding="utf-8",
            )
            lod_script.write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "input_path = Path(sys.argv[1])\n"
                "output_path = input_path.with_name(f'{input_path.stem}-lod.rad')\n"
                "output_path.write_bytes(Path(sys.argv[2]).read_bytes())\n",
                encoding="utf-8",
            )
            storage = Mock()
            storage.provider = "s3"
            storage.config.bucket = "smart-design-documents"
            storage.get_object_bytes.return_value = _valid_rvm_bytes()
            storage.build_object_key.return_value = "projects/project-1/documents/doc-1/revisions/rev-1/rad-file-plant.rad"

            with patch(
                "app.document_conversion_service.get_settings"
            ) as get_settings, patch(
                "app.document_conversion_service.claim_next_document_conversion_job",
                return_value={
                    "id": "job-1",
                    "project_id": "project-1",
                    "document_id": "doc-1",
                    "revision_id": "rev-1",
                    "source_file_id": "source-file",
                    "input_format": "rvm",
                },
            ), patch(
                "app.document_conversion_service.get_project_document_file",
                return_value={
                    "id": "source-file",
                    "original_filename": "plant.rvm",
                    "object_key": "source-key",
                    "status": "ready",
                    "size_bytes": 1024,
                },
            ), patch("app.document_conversion_service.get_document_storage", return_value=storage), patch(
                "app.document_conversion_service.create_project_document_file_record",
                return_value={
                    "id": "rad-file",
                    "original_filename": "plant.rad",
                    "storage_provider": "s3",
                    "bucket": "smart-design-documents",
                    "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/rad-file-plant.rad",
                    "mime_type": "application/octet-stream",
                    "size_bytes": len(_valid_rad_bytes()),
                },
            ), patch(
                "app.document_conversion_service.create_document_visualization"
            ), patch(
                "app.document_conversion_service.replace_document_visualization_assets",
                return_value=[{"filename": "plant.rad"}],
            ), patch(
                "app.document_conversion_service.mark_document_conversion_job_completed"
            ) as mark_completed:
                settings = Mock()
                settings.document_conversion.enabled = True
                settings.document_conversion.max_bytes = 4096
                settings.document_conversion.workdir = str(workdir)
                settings.document_conversion.rvm_converter_command = (
                    f'python "{converter_script}" {{input}} {{output}} "{ply_fixture}"'
                )
                settings.document_conversion.spark_build_lod_command = f'python "{lod_script}" {{input}} "{rad_fixture}"'
                settings.agent.job_timeout_seconds = 30
                get_settings.return_value = settings

                self.assertTrue(run_one_queued_conversion_job())

        self.assertIn("source-splats-lod.rad", mark_completed.call_args.args[2]["commands"]["rad_path"])

    def test_worker_stores_chunked_rad_output_assets(self):
        with TemporaryDirectory() as temp_dir:
            workdir = Path(temp_dir)
            ply_fixture = workdir / "fixture.ply"
            rad_fixture = workdir / "fixture.rad"
            chunk_fixture = workdir / "source-splats-lod-0.radc"
            ply_fixture.write_bytes(_valid_gaussian_ply_bytes())
            rad_fixture.write_bytes(_valid_external_rad_bytes())
            chunk_fixture.write_bytes(b"x" * 128)
            converter_script = workdir / "mock_converter.py"
            lod_script = workdir / "mock_lod.py"
            converter_script.write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "Path(sys.argv[2]).write_bytes(Path(sys.argv[3]).read_bytes())\n",
                encoding="utf-8",
            )
            lod_script.write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "Path(sys.argv[2]).write_bytes(Path(sys.argv[3]).read_bytes())\n"
                "Path('source-splats-lod-0.radc').write_bytes(Path(sys.argv[4]).read_bytes())\n",
                encoding="utf-8",
            )
            storage = Mock()
            storage.provider = "s3"
            storage.config.bucket = "smart-design-documents"
            storage.get_object_bytes.return_value = _valid_rvm_bytes()
            storage.build_object_key.side_effect = [
                "projects/project-1/documents/doc-1/revisions/rev-1/rad-file-plant.rad",
                "projects/project-1/documents/doc-1/revisions/rev-1/chunk-file-source-splats-lod-0.radc",
            ]

            with patch(
                "app.document_conversion_service.get_settings"
            ) as get_settings, patch(
                "app.document_conversion_service.claim_next_document_conversion_job",
                return_value={
                    "id": "job-1",
                    "project_id": "project-1",
                    "document_id": "doc-1",
                    "revision_id": "rev-1",
                    "source_file_id": "source-file",
                    "input_format": "rvm",
                },
            ), patch(
                "app.document_conversion_service.get_project_document_file",
                return_value={
                    "id": "source-file",
                    "original_filename": "plant.rvm",
                    "object_key": "source-key",
                    "status": "ready",
                    "size_bytes": 1024,
                },
            ), patch("app.document_conversion_service.get_document_storage", return_value=storage), patch(
                "app.document_conversion_service.create_project_document_file_record",
                return_value={
                    "id": "rad-file",
                    "original_filename": "plant.rad",
                    "storage_provider": "s3",
                    "bucket": "smart-design-documents",
                    "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/rad-file-plant.rad",
                    "mime_type": "application/octet-stream",
                    "size_bytes": len(_valid_external_rad_bytes()),
                },
            ), patch(
                "app.document_conversion_service.create_document_visualization",
                return_value={"id": "visualization-1"},
            ), patch(
                "app.document_conversion_service.replace_document_visualization_assets",
                side_effect=lambda _project_id, _visualization_id, assets: assets,
            ) as replace_assets, patch(
                "app.document_conversion_service.mark_document_conversion_job_completed"
            ) as mark_completed:
                settings = Mock()
                settings.document_conversion.enabled = True
                settings.document_conversion.max_bytes = 4096
                settings.document_conversion.workdir = str(workdir)
                settings.document_conversion.rvm_converter_command = (
                    f'python "{converter_script}" {{input}} {{output}} "{ply_fixture}"'
                )
                settings.document_conversion.spark_build_lod_command = (
                    f'python "{lod_script}" {{input}} {{output}} "{rad_fixture}" "{chunk_fixture}"'
                )
                settings.agent.job_timeout_seconds = 30
                get_settings.return_value = settings

                self.assertTrue(run_one_queued_conversion_job())

        self.assertEqual(storage.put_object.call_count, 2)
        replace_assets.assert_called_once()
        registered_assets = replace_assets.call_args.args[2]
        self.assertEqual([asset["asset_role"] for asset in registered_assets], ["header", "chunk"])
        self.assertEqual(registered_assets[1]["filename"], "source-splats-lod-0.radc")
        mark_completed.assert_called_once()
        self.assertEqual(len(mark_completed.call_args.args[2]["visualization_assets"]), 2)


if __name__ == "__main__":
    unittest.main()
