from __future__ import annotations

from collections import Counter
import json
import math
from pathlib import Path
import struct
from typing import Any


class ConversionValidationError(ValueError):
    pass


RVM_PRIMITIVE_KIND_NAMES = {
    1: "pyramid",
    2: "box",
    3: "rectangular_torus",
    4: "circular_torus",
    5: "elliptical_dish",
    6: "spherical_dish",
    7: "snout",
    8: "cylinder",
    9: "sphere",
    10: "line",
    11: "facet_group",
}

RVM_GEOMETRY_CHUNKS = frozenset({"PRIM", "OBST", "INSU"})
PLY_GAUSSIAN_COLOR_PROPERTIES = (
    frozenset({"f_dc_0", "f_dc_1", "f_dc_2"}),
    frozenset({"red", "green", "blue"}),
    frozenset({"r", "g", "b"}),
)
PLY_GAUSSIAN_SCALE_PROPERTIES = frozenset({"scale_0", "scale_1", "scale_2"})
PLY_GAUSSIAN_ROTATION_PROPERTIES = frozenset({"rot_0", "rot_1", "rot_2", "rot_3"})
PLY_COMPRESSED_GAUSSIAN_PROPERTIES = frozenset({
    "packed_position",
    "packed_rotation",
    "packed_scale",
    "packed_color",
})
RAD_REQUIRED_CHUNK_PROPERTIES = frozenset({"center", "alpha", "rgb", "scales", "orientation"})
RAD_CHUNK_SIZE = 65536


def summarize_rvm_file(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    data = file_path.read_bytes()
    if not data:
        raise ConversionValidationError("RVM file is empty")

    parser = _RvmBinaryParser(data, str(file_path))
    return parser.parse()


def validate_gaussian_splat_ply(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    header, header_size = _read_ply_header(file_path)
    lines = header.splitlines()
    if not lines or lines[0].strip() != "ply":
        raise ConversionValidationError("PLY output is missing the ply header")

    format_line = _find_ply_format(lines)
    vertex_count, vertex_properties = _extract_ply_vertex_layout(lines)
    if vertex_count <= 0:
        raise ConversionValidationError("Gaussian PLY contains no vertices")
    if file_path.stat().st_size <= header_size:
        raise ConversionValidationError("Gaussian PLY contains no vertex data")

    property_names = {name for _property_type, name in vertex_properties}
    is_standard_gaussian = _is_standard_gaussian_ply(property_names)
    is_compressed_gaussian = PLY_COMPRESSED_GAUSSIAN_PROPERTIES.issubset(property_names)
    if not is_standard_gaussian and not is_compressed_gaussian:
        raise ConversionValidationError(
            "PLY output is not a Spark-compatible Gaussian splat PLY; "
            "expected position, opacity, scale, rotation, and color properties"
        )

    return {
        "format": format_line,
        "vertex_count": vertex_count,
        "property_count": len(vertex_properties),
        "properties": [name for _property_type, name in vertex_properties],
        "encoding": "compressed_gaussian" if is_compressed_gaussian else "gaussian",
        "has_spherical_harmonics": any(name.startswith("f_rest_") for name in property_names),
    }


def validate_spark_rad_file(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    data = file_path.read_bytes()
    if len(data) < 8:
        raise ConversionValidationError("RAD output is too small")
    if data[:4] != b"RAD0":
        raise ConversionValidationError("RAD output is missing RAD0 magic")

    meta_length = int.from_bytes(data[4:8], "little")
    meta_start = 8
    meta_end = meta_start + meta_length
    if meta_length <= 0 or meta_end > len(data):
        raise ConversionValidationError("RAD metadata header is truncated")

    try:
        meta = json.loads(data[meta_start:meta_end])
    except json.JSONDecodeError as error:
        raise ConversionValidationError("RAD metadata header is not valid JSON") from error

    _validate_rad_meta(meta)
    count = int(meta["count"])
    chunk_size = int(meta.get("chunkSize") or RAD_CHUNK_SIZE)
    chunks = list(meta["chunks"])
    expected_chunk_count = math.ceil(count / chunk_size)
    if len(chunks) != expected_chunk_count:
        raise ConversionValidationError(
            f"RAD chunk count mismatch: expected {expected_chunk_count}, got {len(chunks)}"
        )

    chunks_start = meta_start + _roundup8(meta_length)
    all_chunk_bytes = int(meta.get("allChunkBytes") or 0)
    if all_chunk_bytes <= 0:
        raise ConversionValidationError("RAD metadata reports no chunk bytes")

    has_external_chunks = any("filename" in chunk for chunk in chunks)
    external_chunk_files: list[dict[str, Any]] = []
    radc_summaries: list[dict[str, Any]] = []
    if has_external_chunks:
        _validate_external_rad_chunks(chunks)
        external_chunk_files = [
            {"filename": str(chunk["filename"]), "bytes": int(chunk.get("bytes") or 0)}
            for chunk in chunks
            if "filename" in chunk
        ]
    else:
        radc_summaries = _validate_embedded_rad_chunks(data, chunks_start, chunks, all_chunk_bytes)

    comment_json = _parse_rad_comment(meta.get("comment"))
    return {
        "version": int(meta["version"]),
        "type": meta["type"],
        "count": count,
        "max_sh": meta.get("maxSh"),
        "lod_tree": bool(meta.get("lodTree")),
        "chunk_size": chunk_size,
        "chunk_count": len(chunks),
        "all_chunk_bytes": all_chunk_bytes,
        "external_chunks": has_external_chunks,
        "external_chunk_files": external_chunk_files,
        "comment_json": comment_json,
        "embedded_chunk_properties": radc_summaries[:3],
    }


def cross_check_conversion_summaries(ply_summary: dict[str, Any], rad_summary: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    comment = rad_summary.get("comment_json") or {}
    input_splat_count = _maybe_int(comment.get("input_splat_count"))
    if input_splat_count is None:
        warnings.append("RAD metadata comment does not include input_splat_count")
    elif input_splat_count != int(ply_summary["vertex_count"]):
        raise ConversionValidationError(
            f"RAD input_splat_count {input_splat_count} does not match PLY vertex_count {ply_summary['vertex_count']}"
        )

    final_splat_count = _maybe_int(comment.get("final_splat_count"))
    if final_splat_count is None:
        warnings.append("RAD metadata comment does not include final_splat_count")
    elif final_splat_count != int(rad_summary["count"]):
        raise ConversionValidationError(
            f"RAD final_splat_count {final_splat_count} does not match RAD count {rad_summary['count']}"
        )
    return warnings


class _RvmBinaryParser:
    def __init__(self, data: bytes, path: str) -> None:
        self.data = data
        self.path = path
        self.group_count = 0
        self.color_count = 0
        self.geometry_count = 0
        self.geometry_type_counts: Counter[str] = Counter()
        self.primitive_counts: Counter[str] = Counter()
        self.facet_triangle_count = 0
        self.facet_quad_count = 0
        self.facet_polygon_count = 0
        self.facet_polygon_contour_count = 0
        self.facet_polygon_vertex_count = 0
        self.group_name_samples: list[str] = []
        self.bbox_min = [math.inf, math.inf, math.inf]
        self.bbox_max = [-math.inf, -math.inf, -math.inf]
        self.head: dict[str, Any] = {}
        self.model: dict[str, Any] = {}

    def parse(self) -> dict[str, Any]:
        chunk_id, next_offset, _aux, payload_offset = self._read_chunk_header(0)
        if chunk_id != "HEAD":
            raise ConversionValidationError(f"Expected RVM HEAD chunk, got {chunk_id}")
        offset = self._parse_head(payload_offset, next_offset)

        chunk_id, next_offset, _aux, payload_offset = self._read_chunk_header(offset)
        if chunk_id != "MODL":
            raise ConversionValidationError(f"Expected RVM MODL chunk, got {chunk_id}")
        offset = self._parse_modl(payload_offset, next_offset)

        while offset < len(self.data):
            chunk_id, next_offset, _aux, payload_offset = self._read_chunk_header(offset)
            if chunk_id == "END:":
                break
            if chunk_id == "CNTB":
                offset = self._parse_cntb(payload_offset, next_offset)
            elif chunk_id in RVM_GEOMETRY_CHUNKS:
                offset = self._parse_prim(payload_offset, next_offset, chunk_id)
            elif chunk_id == "COLR":
                offset = self._parse_colr(payload_offset, next_offset)
            elif chunk_id == "CNTE":
                offset = self._read_u32(payload_offset)[1]
            else:
                raise ConversionValidationError(f"Unrecognized RVM chunk {chunk_id} at byte {offset}")

        if self.geometry_count <= 0:
            raise ConversionValidationError("RVM contains no geometry primitives")

        bbox = None
        if all(math.isfinite(value) for value in [*self.bbox_min, *self.bbox_max]):
            bbox = {"min": self.bbox_min, "max": self.bbox_max}

        return {
            "format": "AVEVA PDMS binary RVM",
            "source": self.path,
            "file_size_bytes": len(self.data),
            "head": self.head,
            "model": self.model,
            "group_count": self.group_count,
            "geometry_count": self.geometry_count,
            "geometry_type_counts": dict(sorted(self.geometry_type_counts.items())),
            "primitive_counts": dict(sorted(self.primitive_counts.items())),
            "color_count": self.color_count,
            "facet_triangle_count": self.facet_triangle_count,
            "facet_quad_count": self.facet_quad_count,
            "facet_polygon_count": self.facet_polygon_count,
            "facet_polygon_contour_count": self.facet_polygon_contour_count,
            "facet_polygon_vertex_count": self.facet_polygon_vertex_count,
            "bbox_world": bbox,
            "group_name_samples": self.group_name_samples,
        }

    def _read_chunk_header(self, offset: int) -> tuple[str, int, int, int]:
        self._require_available(offset, 24, "RVM chunk header")
        id_bytes = []
        for index in range(4):
            base = offset + index * 4
            if self.data[base:base + 3] != b"\x00\x00\x00":
                raise ConversionValidationError(f"Invalid RVM chunk id encoding at byte {offset}")
            id_bytes.append(self.data[base + 3])
        try:
            chunk_id = bytes(id_bytes).decode("ascii")
        except UnicodeDecodeError as error:
            raise ConversionValidationError(f"RVM chunk id is not ASCII at byte {offset}") from error
        next_offset = self._u32_at(offset + 16)
        aux = self._u32_at(offset + 20)
        return chunk_id, next_offset, aux, offset + 24

    def _parse_head(self, offset: int, expected_offset: int) -> int:
        version, offset = self._read_u32(offset)
        info, offset = self._read_string(offset)
        note, offset = self._read_string(offset)
        date, offset = self._read_string(offset)
        user, offset = self._read_string(offset)
        encoding = ""
        if version >= 2:
            encoding, offset = self._read_string(offset)
        self._require_expected_offset("HEAD", offset, expected_offset)
        self.head = {
            "version": version,
            "info": info,
            "note": note,
            "date": date,
            "user": user,
            "encoding": encoding,
        }
        return offset

    def _parse_modl(self, offset: int, expected_offset: int) -> int:
        version, offset = self._read_u32(offset)
        project, offset = self._read_string(offset)
        name, offset = self._read_string(offset)
        self._require_expected_offset("MODL", offset, expected_offset)
        self.model = {"version": version, "project": project, "name": name}
        return offset

    def _parse_cntb(self, offset: int, expected_offset: int) -> int:
        self.group_count += 1
        version, offset = self._read_u32(offset)
        group_name, offset = self._read_string(offset)
        if group_name and len(self.group_name_samples) < 8:
            self.group_name_samples.append(group_name)
        for _index in range(3):
            _value, offset = self._read_f32(offset)
        _material, offset = self._read_u32(offset)
        if version > 2:
            self._require_available(offset, 4, "RVM CNTB transparency")
            offset += 4
        self._require_expected_offset("CNTB", offset, expected_offset)

        while offset < len(self.data):
            chunk_id, next_offset, _aux, payload_offset = self._read_chunk_header(offset)
            if chunk_id == "CNTE":
                _version, offset = self._read_u32(payload_offset)
                return offset
            if chunk_id == "CNTB":
                offset = self._parse_cntb(payload_offset, next_offset)
            elif chunk_id in RVM_GEOMETRY_CHUNKS:
                offset = self._parse_prim(payload_offset, next_offset, chunk_id)
            else:
                raise ConversionValidationError(f"Unrecognized RVM child chunk {chunk_id} at byte {offset}")
        raise ConversionValidationError("RVM CNTB group is missing closing CNTE")

    def _parse_prim(self, offset: int, expected_offset: int, chunk_id: str) -> int:
        _version, offset = self._read_u32(offset)
        kind, offset = self._read_u32(offset)
        matrix, offset = self._read_f32_array(offset, 12)
        bbox_local, offset = self._read_f32_array(offset, 6)
        if chunk_id in {"OBST", "INSU"}:
            self._require_available(offset, 4, f"RVM {chunk_id} transparency")
            offset += 4

        primitive_name = RVM_PRIMITIVE_KIND_NAMES.get(kind)
        if primitive_name is None:
            raise ConversionValidationError(f"Unknown RVM primitive kind {kind}")

        if kind == 1:
            _values, offset = self._read_f32_array(offset, 7)
        elif kind == 2:
            _values, offset = self._read_f32_array(offset, 3)
        elif kind == 3:
            _values, offset = self._read_f32_array(offset, 4)
        elif kind == 4:
            _values, offset = self._read_f32_array(offset, 3)
        elif kind in {5, 6, 8, 10}:
            _values, offset = self._read_f32_array(offset, 2)
        elif kind == 7:
            _values, offset = self._read_f32_array(offset, 9)
        elif kind == 9:
            _values, offset = self._read_f32_array(offset, 1)
        elif kind == 11:
            offset = self._parse_facet_group(offset)

        self._require_expected_offset("PRIM", offset, expected_offset)
        self.geometry_count += 1
        self.geometry_type_counts[_geometry_type_name(chunk_id)] += 1
        self.primitive_counts[primitive_name] += 1
        self._extend_world_bbox(matrix, bbox_local)
        return offset

    def _parse_facet_group(self, offset: int) -> int:
        polygon_count, offset = self._read_u32(offset)
        for _polygon_index in range(polygon_count):
            contour_count, offset = self._read_u32(offset)
            polygon_vertex_count = 0
            for _contour_index in range(contour_count):
                vertex_count, offset = self._read_u32(offset)
                polygon_vertex_count += vertex_count
                offset = self._skip(offset, vertex_count * 6 * 4, "RVM facet vertices")
            if contour_count == 1 and polygon_vertex_count == 3:
                self.facet_triangle_count += 1
            elif contour_count == 1 and polygon_vertex_count == 4:
                self.facet_quad_count += 1
            else:
                self.facet_polygon_count += 1
                self.facet_polygon_contour_count += contour_count
                self.facet_polygon_vertex_count += polygon_vertex_count
        return offset

    def _parse_colr(self, offset: int, expected_offset: int) -> int:
        _kind, offset = self._read_u32(offset)
        _index, offset = self._read_u32(offset)
        offset = self._skip(offset, 4, "RVM COLR rgb")
        self._require_expected_offset("COLR", offset, expected_offset)
        self.color_count += 1
        return offset

    def _extend_world_bbox(self, matrix: list[float], bbox: list[float]) -> None:
        min_x, min_y, min_z, max_x, max_y, max_z = bbox
        for x in (min_x, max_x):
            for y in (min_y, max_y):
                for z in (min_z, max_z):
                    world = [
                        matrix[0] * x + matrix[3] * y + matrix[6] * z + matrix[9],
                        matrix[1] * x + matrix[4] * y + matrix[7] * z + matrix[10],
                        matrix[2] * x + matrix[5] * y + matrix[8] * z + matrix[11],
                    ]
                    if all(math.isfinite(value) for value in world):
                        for index, value in enumerate(world):
                            self.bbox_min[index] = min(self.bbox_min[index], value)
                            self.bbox_max[index] = max(self.bbox_max[index], value)

    def _read_string(self, offset: int) -> tuple[str, int]:
        units, offset = self._read_u32(offset)
        byte_count = units * 4
        self._require_available(offset, byte_count, "RVM string")
        raw = self.data[offset:offset + byte_count]
        nul = raw.find(b"\x00")
        if nul >= 0:
            raw = raw[:nul]
        return raw.decode("utf-8", errors="replace"), offset + byte_count

    def _read_u32(self, offset: int) -> tuple[int, int]:
        self._require_available(offset, 4, "RVM uint32")
        return self._u32_at(offset), offset + 4

    def _read_f32(self, offset: int) -> tuple[float, int]:
        self._require_available(offset, 4, "RVM float32")
        return struct.unpack(">f", self.data[offset:offset + 4])[0], offset + 4

    def _read_f32_array(self, offset: int, count: int) -> tuple[list[float], int]:
        values: list[float] = []
        for _index in range(count):
            value, offset = self._read_f32(offset)
            values.append(value)
        return values, offset

    def _u32_at(self, offset: int) -> int:
        return int.from_bytes(self.data[offset:offset + 4], "big")

    def _skip(self, offset: int, byte_count: int, context: str) -> int:
        self._require_available(offset, byte_count, context)
        return offset + byte_count

    def _require_available(self, offset: int, byte_count: int, context: str) -> None:
        if byte_count < 0 or offset < 0 or offset + byte_count > len(self.data):
            raise ConversionValidationError(f"{context} is truncated at byte {offset}")

    def _require_expected_offset(self, chunk_id: str, offset: int, expected_offset: int) -> None:
        if offset != expected_offset:
            raise ConversionValidationError(
                f"RVM {chunk_id} chunk length mismatch: expected byte {expected_offset}, got {offset}"
            )


def _read_ply_header(path: Path) -> tuple[str, int]:
    max_header_bytes = 512 * 1024
    data = bytearray()
    with path.open("rb") as file:
        while len(data) <= max_header_bytes:
            chunk = file.read(8192)
            if not chunk:
                break
            data.extend(chunk)
            marker = data.find(b"end_header\n")
            if marker >= 0:
                header_end = marker + len(b"end_header\n")
                return data[:header_end].decode("ascii", errors="replace"), header_end
            marker = data.find(b"end_header\r\n")
            if marker >= 0:
                header_end = marker + len(b"end_header\r\n")
                return data[:header_end].decode("ascii", errors="replace"), header_end
    raise ConversionValidationError("PLY output is missing end_header")


def _find_ply_format(lines: list[str]) -> str:
    for line in lines:
        fields = line.strip().split()
        if len(fields) >= 3 and fields[0] == "format":
            if fields[1] not in {"ascii", "binary_little_endian", "binary_big_endian"}:
                raise ConversionValidationError(f"Unsupported PLY format {fields[1]}")
            return fields[1]
    raise ConversionValidationError("PLY output is missing format line")


def _extract_ply_vertex_layout(lines: list[str]) -> tuple[int, list[tuple[str, str]]]:
    vertex_count = 0
    vertex_properties: list[tuple[str, str]] = []
    current_element: str | None = None
    for line in lines:
        fields = line.strip().split()
        if not fields or fields[0] in {"comment", "obj_info"}:
            continue
        if fields[0] == "element" and len(fields) >= 3:
            current_element = fields[1]
            if current_element == "vertex":
                try:
                    vertex_count = int(fields[2])
                except ValueError as error:
                    raise ConversionValidationError("PLY vertex count is not an integer") from error
            continue
        if fields[0] == "property" and current_element == "vertex":
            if len(fields) < 3:
                raise ConversionValidationError("PLY vertex property line is malformed")
            vertex_properties.append((fields[-2], fields[-1]))
    if not vertex_properties:
        raise ConversionValidationError("PLY output has no vertex properties")
    return vertex_count, vertex_properties


def _is_standard_gaussian_ply(property_names: set[str]) -> bool:
    has_position = {"x", "y", "z"}.issubset(property_names)
    has_opacity = "opacity" in property_names or "alpha" in property_names
    has_scale = PLY_GAUSSIAN_SCALE_PROPERTIES.issubset(property_names)
    has_rotation = PLY_GAUSSIAN_ROTATION_PROPERTIES.issubset(property_names)
    has_color = any(required.issubset(property_names) for required in PLY_GAUSSIAN_COLOR_PROPERTIES)
    return has_position and has_opacity and has_scale and has_rotation and has_color


def _validate_rad_meta(meta: dict[str, Any]) -> None:
    if int(meta.get("version") or 0) != 1:
        raise ConversionValidationError(f"Unsupported RAD version {meta.get('version')}")
    if meta.get("type") != "gsplat":
        raise ConversionValidationError(f"Unsupported RAD type {meta.get('type')}")
    if int(meta.get("count") or 0) <= 0:
        raise ConversionValidationError("RAD contains no splats")
    if int(meta.get("chunkSize") or RAD_CHUNK_SIZE) <= 0:
        raise ConversionValidationError("RAD chunkSize must be greater than zero")
    if not isinstance(meta.get("chunks"), list) or not meta["chunks"]:
        raise ConversionValidationError("RAD metadata contains no chunks")


def _validate_external_rad_chunks(chunks: list[dict[str, Any]]) -> None:
    for index, chunk in enumerate(chunks):
        if int(chunk.get("offset") or 0) < 0 or "offset" not in chunk:
            raise ConversionValidationError(f"RAD chunk {index} is missing offset")
        if not chunk.get("filename"):
            raise ConversionValidationError(f"RAD chunk {index} is missing filename")
        if int(chunk.get("bytes") or 0) <= 0:
            raise ConversionValidationError(f"RAD chunk {index} reports no bytes")


def _validate_embedded_rad_chunks(
    data: bytes,
    chunks_start: int,
    chunks: list[dict[str, Any]],
    all_chunk_bytes: int,
) -> list[dict[str, Any]]:
    if chunks_start + all_chunk_bytes > len(data):
        raise ConversionValidationError("RAD embedded chunk data is truncated")

    max_chunk_end = 0
    summaries: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        chunk_offset = int(chunk.get("offset") or 0)
        chunk_bytes = int(chunk.get("bytes") or 0)
        if chunk_offset < 0 or chunk_bytes <= 0:
            raise ConversionValidationError(f"RAD chunk {index} has invalid offset or bytes")
        chunk_end = chunk_offset + chunk_bytes
        if chunk_end > all_chunk_bytes:
            raise ConversionValidationError(f"RAD chunk {index} extends beyond allChunkBytes")
        summaries.append(_validate_radc_chunk(data, chunks_start + chunk_offset, chunk_bytes, index))
        max_chunk_end = max(max_chunk_end, chunk_end)

    if max_chunk_end != all_chunk_bytes:
        raise ConversionValidationError("RAD allChunkBytes does not match embedded chunk ranges")
    return summaries


def _validate_radc_chunk(data: bytes, offset: int, byte_count: int, index: int) -> dict[str, Any]:
    if byte_count < 16 or offset + byte_count > len(data):
        raise ConversionValidationError(f"RADC chunk {index} is truncated")
    if data[offset:offset + 4] != b"RADC":
        raise ConversionValidationError(f"RADC chunk {index} is missing RADC magic")
    meta_length = int.from_bytes(data[offset + 4:offset + 8], "little")
    meta_start = offset + 8
    meta_end = meta_start + meta_length
    payload_size_offset = meta_start + _roundup8(meta_length)
    if meta_length <= 0 or payload_size_offset + 8 > offset + byte_count:
        raise ConversionValidationError(f"RADC chunk {index} metadata is truncated")
    try:
        meta = json.loads(data[meta_start:meta_end])
    except json.JSONDecodeError as error:
        raise ConversionValidationError(f"RADC chunk {index} metadata is not valid JSON") from error

    if int(meta.get("version") or 0) != 1:
        raise ConversionValidationError(f"Unsupported RADC chunk version {meta.get('version')}")
    count = int(meta.get("count") or 0)
    if count <= 0:
        raise ConversionValidationError(f"RADC chunk {index} contains no splats")
    payload_bytes = int.from_bytes(data[payload_size_offset:payload_size_offset + 8], "little")
    if payload_bytes <= 0:
        raise ConversionValidationError(f"RADC chunk {index} payload is empty")
    if payload_size_offset + 8 + _roundup8(payload_bytes) > offset + byte_count:
        raise ConversionValidationError(f"RADC chunk {index} payload is truncated")

    properties = meta.get("properties")
    if not isinstance(properties, list):
        raise ConversionValidationError(f"RADC chunk {index} properties are missing")
    property_names = {str(prop.get("property") or "") for prop in properties if isinstance(prop, dict)}
    missing = sorted(RAD_REQUIRED_CHUNK_PROPERTIES.difference(property_names))
    if missing:
        raise ConversionValidationError(f"RADC chunk {index} is missing properties: {', '.join(missing)}")

    for prop in properties:
        if not isinstance(prop, dict):
            raise ConversionValidationError(f"RADC chunk {index} property is malformed")
        prop_offset = int(prop.get("offset") or 0)
        prop_bytes = int(prop.get("bytes") or 0)
        if prop_offset < 0 or prop_bytes <= 0 or prop_offset + prop_bytes > payload_bytes:
            raise ConversionValidationError(f"RADC chunk {index} property range is invalid")

    return {
        "index": index,
        "base": int(meta.get("base") or 0),
        "count": count,
        "payload_bytes": payload_bytes,
        "property_count": len(properties),
        "properties": sorted(property_names),
    }


def _parse_rad_comment(comment: Any) -> dict[str, Any] | None:
    if not isinstance(comment, str) or not comment.strip():
        return None
    try:
        value = json.loads(comment)
    except json.JSONDecodeError:
        return None
    if isinstance(value, dict):
        return value
    return None


def _roundup8(value: int) -> int:
    return (value + 7) & ~7


def _maybe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _geometry_type_name(chunk_id: str) -> str:
    if chunk_id == "PRIM":
        return "primitive"
    if chunk_id == "OBST":
        return "obstruction"
    if chunk_id == "INSU":
        return "insulation"
    return chunk_id.lower()
