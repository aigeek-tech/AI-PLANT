from __future__ import annotations

import argparse
import bisect
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
from typing import Any, Iterable


SH_C0 = 0.28209479177387814
GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENT_FORMATS = {
    5120: ("b", 1, False),
    5121: ("B", 1, False),
    5122: ("h", 2, False),
    5123: ("H", 2, False),
    5125: ("I", 4, False),
    5126: ("f", 4, False),
}
TYPE_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert AVEVA RVM to Spark-compatible Gaussian PLY.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workdir")
    parser.add_argument("--rvmparser-bin", default=os.getenv("RVMPARSER_BIN", "rvmparser"))
    parser.add_argument("--tolerance", type=float, default=float(os.getenv("RVM_TESSELLATION_TOLERANCE", "0.1")))
    parser.add_argument("--max-splats", type=int, default=int(os.getenv("RVM_TO_SPLAT_MAX_SPLATS", "250000")))
    parser.add_argument("--sample-spacing", type=float, default=float(os.getenv("RVM_TO_SPLAT_SAMPLE_SPACING", "0.25")))
    parser.add_argument("--opacity", type=float, default=float(os.getenv("RVM_TO_SPLAT_OPACITY", "0.88")))
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with _conversion_workdir(args.workdir) as workdir:
        glb_path = workdir / "source.glb"
        _run_rvmparser(args.rvmparser_bin, input_path, glb_path, args.tolerance)
        triangles = list(_read_glb_triangles(glb_path))
        if not triangles:
            raise RuntimeError("RVM parser produced a GLB with no triangle geometry")
        splats = _sample_triangles(
            triangles,
            max_splats=max(1, args.max_splats),
            sample_spacing=max(0.000001, args.sample_spacing),
            opacity=min(0.999, max(0.001, args.opacity)),
        )
        _write_gaussian_ply(output_path, splats)
    return 0


def _conversion_workdir(workdir: str | None):
    if workdir:
        path = Path(workdir).resolve() / "rvm-to-spark-ply"
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)

        class _ExistingWorkdir:
            def __enter__(self):
                return path

            def __exit__(self, *_args):
                shutil.rmtree(path, ignore_errors=True)

        return _ExistingWorkdir()

    class _TemporaryWorkdir:
        def __enter__(self):
            self._temporary = tempfile.TemporaryDirectory(prefix="rvm-to-spark-ply-")
            return Path(self._temporary.__enter__())

        def __exit__(self, *args):
            return self._temporary.__exit__(*args)

    return _TemporaryWorkdir()


def _run_rvmparser(binary: str, input_path: Path, glb_path: Path, tolerance: float) -> None:
    command = [
        binary,
        f"--output-gltf={glb_path}",
        "--output-gltf-center=true",
        "--output-gltf-rotate-z-to-y=true",
        "--output-gltf-attributes=false",
        f"--tolerance={tolerance:g}",
        str(input_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(stderr or f"rvmparser failed with exit code {completed.returncode}")
    if not glb_path.exists() or glb_path.stat().st_size <= 0:
        raise RuntimeError("rvmparser did not create a GLB file")


def _read_glb(path: Path) -> tuple[dict[str, Any], bytes]:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != GLB_MAGIC:
        raise RuntimeError("rvmparser output is not a GLB file")
    version, total_length = struct.unpack_from("<II", data, 4)
    if version != 2 or total_length > len(data):
        raise RuntimeError("Unsupported or truncated GLB file")

    offset = 12
    document: dict[str, Any] | None = None
    binary = b""
    while offset + 8 <= total_length:
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == JSON_CHUNK:
            document = json.loads(chunk.decode("utf-8"))
        elif chunk_type == BIN_CHUNK:
            binary = chunk
    if document is None:
        raise RuntimeError("GLB file has no JSON chunk")
    return document, binary


def _read_glb_triangles(path: Path) -> Iterable[dict[str, Any]]:
    document, binary = _read_glb(path)
    materials = document.get("materials") or []
    meshes = document.get("meshes") or []
    nodes = document.get("nodes") or []
    scene_ids = [document.get("scene", 0)]
    if document.get("scenes"):
        scene_ids = [scene_id for scene_id in scene_ids if isinstance(scene_id, int)]
    roots: list[int] = []
    for scene_id in scene_ids:
        if 0 <= scene_id < len(document.get("scenes") or []):
            roots.extend(document["scenes"][scene_id].get("nodes") or [])
    if not roots:
        roots = list(range(len(nodes)))

    for node_id in roots:
        yield from _walk_node(document, binary, meshes, materials, nodes, int(node_id), _identity())


def _walk_node(
    document: dict[str, Any],
    binary: bytes,
    meshes: list[dict[str, Any]],
    materials: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    node_id: int,
    parent_matrix: list[float],
) -> Iterable[dict[str, Any]]:
    if node_id < 0 or node_id >= len(nodes):
        return
    node = nodes[node_id]
    matrix = _mat4_mul(parent_matrix, _node_matrix(node))
    mesh_id = node.get("mesh")
    if isinstance(mesh_id, int) and 0 <= mesh_id < len(meshes):
        for primitive in meshes[mesh_id].get("primitives") or []:
            if int(primitive.get("mode", 4)) != 4:
                continue
            yield from _primitive_triangles(document, binary, materials, primitive, matrix)
    for child_id in node.get("children") or []:
        yield from _walk_node(document, binary, meshes, materials, nodes, int(child_id), matrix)


def _primitive_triangles(
    document: dict[str, Any],
    binary: bytes,
    materials: list[dict[str, Any]],
    primitive: dict[str, Any],
    matrix: list[float],
) -> Iterable[dict[str, Any]]:
    attributes = primitive.get("attributes") or {}
    position_accessor = attributes.get("POSITION")
    if position_accessor is None:
        return
    positions = _read_accessor(document, binary, int(position_accessor))
    indices = _read_accessor(document, binary, int(primitive["indices"])) if "indices" in primitive else list(range(len(positions)))
    colors = _read_accessor(document, binary, int(attributes["COLOR_0"])) if "COLOR_0" in attributes else None
    material_color = _material_color(materials, primitive.get("material"))

    for index in range(0, len(indices) - 2, 3):
        i0, i1, i2 = int(indices[index]), int(indices[index + 1]), int(indices[index + 2])
        if max(i0, i1, i2) >= len(positions):
            continue
        p0 = _transform_point(matrix, positions[i0][:3])
        p1 = _transform_point(matrix, positions[i1][:3])
        p2 = _transform_point(matrix, positions[i2][:3])
        normal = _normal(p0, p1, p2)
        area = _triangle_area(p0, p1, p2)
        if area <= 0:
            continue
        color = material_color
        if colors:
            color = _average_color(colors[i0], colors[i1], colors[i2])
        yield {"p0": p0, "p1": p1, "p2": p2, "normal": normal, "area": area, "color": color}


def _read_accessor(document: dict[str, Any], binary: bytes, accessor_id: int) -> list[Any]:
    accessors = document.get("accessors") or []
    buffer_views = document.get("bufferViews") or []
    accessor = accessors[accessor_id]
    component_type = int(accessor["componentType"])
    fmt, component_size, normalized_by_default = COMPONENT_FORMATS[component_type]
    count = int(accessor["count"])
    item_size = TYPE_COUNTS[accessor["type"]]
    view = buffer_views[int(accessor["bufferView"])]
    base_offset = int(view.get("byteOffset") or 0) + int(accessor.get("byteOffset") or 0)
    stride = int(view.get("byteStride") or component_size * item_size)
    normalized = bool(accessor.get("normalized") or False)
    unpack = struct.Struct("<" + fmt * item_size)

    values: list[Any] = []
    for row in range(count):
        raw = unpack.unpack_from(binary, base_offset + row * stride)
        item = [_normalize_component(value, component_type, normalized or normalized_by_default) for value in raw]
        values.append(item[0] if item_size == 1 else item)
    return values


def _normalize_component(value: float | int, component_type: int, normalized: bool) -> float | int:
    if not normalized or component_type == 5126:
        return value
    if component_type == 5121:
        return float(value) / 255.0
    if component_type == 5123:
        return float(value) / 65535.0
    if component_type == 5120:
        return max(-1.0, float(value) / 127.0)
    if component_type == 5122:
        return max(-1.0, float(value) / 32767.0)
    return value


def _sample_triangles(triangles: list[dict[str, Any]], *, max_splats: int, sample_spacing: float, opacity: float) -> list[tuple[float, ...]]:
    total_area = sum(triangle["area"] for triangle in triangles)
    target_count = min(max_splats, max(len(triangles), int(math.ceil(total_area / (sample_spacing * sample_spacing)))))
    cumulative: list[float] = []
    running = 0.0
    for triangle in triangles:
        running += triangle["area"]
        cumulative.append(running)

    base_radius = max(sample_spacing * 0.5, math.sqrt(max(total_area / target_count, 1e-12)) * 0.55)
    log_scale = math.log(max(base_radius, 1e-6))
    opacity_logit = math.log(opacity / (1.0 - opacity))
    splats: list[tuple[float, ...]] = []
    for sample_id in range(target_count):
        target = ((sample_id + 0.5) / target_count) * total_area
        triangle = triangles[min(bisect.bisect_left(cumulative, target), len(triangles) - 1)]
        u = _fract((sample_id + 1) * 0.7548776662466927)
        v = _fract((sample_id + 1) * 0.5698402909980532)
        if u + v > 1.0:
            u = 1.0 - u
            v = 1.0 - v
        w = 1.0 - u - v
        p0, p1, p2 = triangle["p0"], triangle["p1"], triangle["p2"]
        x = p0[0] * w + p1[0] * u + p2[0] * v
        y = p0[1] * w + p1[1] * u + p2[1] * v
        z = p0[2] * w + p1[2] * u + p2[2] * v
        nx, ny, nz = triangle["normal"]
        r, g, b = triangle["color"]
        splats.append((
            x, y, z,
            nx, ny, nz,
            _dc(r), _dc(g), _dc(b),
            opacity_logit,
            log_scale, log_scale, log_scale,
            1.0, 0.0, 0.0, 0.0,
        ))
    return splats


def _write_gaussian_ply(path: Path, splats: list[tuple[float, ...]]) -> None:
    header = "\n".join([
        "ply",
        "format binary_little_endian 1.0",
        "comment generated_by smart_design rvm_to_spark_ply",
        f"element vertex {len(splats)}",
        "property float x",
        "property float y",
        "property float z",
        "property float nx",
        "property float ny",
        "property float nz",
        "property float f_dc_0",
        "property float f_dc_1",
        "property float f_dc_2",
        "property float opacity",
        "property float scale_0",
        "property float scale_1",
        "property float scale_2",
        "property float rot_0",
        "property float rot_1",
        "property float rot_2",
        "property float rot_3",
        "end_header",
        "",
    ]).encode("ascii")
    packer = struct.Struct("<17f")
    with path.open("wb") as file:
        file.write(header)
        for splat in splats:
            file.write(packer.pack(*splat))


def _material_color(materials: list[dict[str, Any]], material_id: Any) -> tuple[float, float, float]:
    if isinstance(material_id, int) and 0 <= material_id < len(materials):
        pbr = materials[material_id].get("pbrMetallicRoughness") or {}
        base = pbr.get("baseColorFactor")
        if isinstance(base, list) and len(base) >= 3:
            return _clamp01(base[0]), _clamp01(base[1]), _clamp01(base[2])
    return 0.72, 0.76, 0.80


def _average_color(*values: Any) -> tuple[float, float, float]:
    channels = [0.0, 0.0, 0.0]
    for value in values:
        if isinstance(value, list) and len(value) >= 3:
            channels[0] += _clamp01(value[0])
            channels[1] += _clamp01(value[1])
            channels[2] += _clamp01(value[2])
    return channels[0] / 3.0, channels[1] / 3.0, channels[2] / 3.0


def _dc(value: float) -> float:
    return (_clamp01(value) - 0.5) / SH_C0


def _clamp01(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(1.0, max(0.0, number))


def _triangle_area(a: list[float], b: list[float], c: list[float]) -> float:
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    return 0.5 * math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2)


def _normal(a: list[float], b: list[float], c: list[float]) -> tuple[float, float, float]:
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length <= 0:
        return 0.0, 1.0, 0.0
    return nx / length, ny / length, nz / length


def _fract(value: float) -> float:
    return value - math.floor(value)


def _identity() -> list[float]:
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def _node_matrix(node: dict[str, Any]) -> list[float]:
    if isinstance(node.get("matrix"), list) and len(node["matrix"]) == 16:
        return [float(value) for value in node["matrix"]]
    translation = node.get("translation") if isinstance(node.get("translation"), list) else [0, 0, 0]
    scale = node.get("scale") if isinstance(node.get("scale"), list) else [1, 1, 1]
    rotation = node.get("rotation") if isinstance(node.get("rotation"), list) else [0, 0, 0, 1]
    return _mat4_mul(_translation(translation), _mat4_mul(_quat_matrix(rotation), _scale(scale)))


def _translation(value: list[Any]) -> list[float]:
    matrix = _identity()
    matrix[12], matrix[13], matrix[14] = float(value[0]), float(value[1]), float(value[2])
    return matrix


def _scale(value: list[Any]) -> list[float]:
    matrix = _identity()
    matrix[0], matrix[5], matrix[10] = float(value[0]), float(value[1]), float(value[2])
    return matrix


def _quat_matrix(value: list[Any]) -> list[float]:
    x, y, z, w = [float(item) for item in value[:4]]
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return [
        1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
        2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
        2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
        0, 0, 0, 1,
    ]


def _mat4_mul(a: list[float], b: list[float]) -> list[float]:
    out = [0.0] * 16
    for column in range(4):
        for row in range(4):
            out[column * 4 + row] = sum(a[k * 4 + row] * b[column * 4 + k] for k in range(4))
    return out


def _transform_point(matrix: list[float], point: list[float]) -> list[float]:
    x, y, z = point
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ]


if __name__ == "__main__":
    raise SystemExit(main())
