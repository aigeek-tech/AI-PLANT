from __future__ import annotations

import json
import struct
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.document_conversion_validation import validate_gaussian_splat_ply
from tools.rvm_to_spark_ply import _read_glb_triangles, _sample_triangles, _write_gaussian_ply
from tools.spark_build_lod import _build_lod_command


class ConversionToolsTest(unittest.TestCase):
    def test_samples_glb_mesh_into_gaussian_ply(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            glb_path = temp_path / "triangle.glb"
            ply_path = temp_path / "triangle.ply"
            _write_triangle_glb(glb_path)

            triangles = list(_read_glb_triangles(glb_path))
            self.assertEqual(len(triangles), 1)
            splats = _sample_triangles(triangles, max_splats=8, sample_spacing=0.5, opacity=0.88)
            self.assertGreaterEqual(len(splats), 1)
            _write_gaussian_ply(ply_path, splats)

            summary = validate_gaussian_splat_ply(ply_path)
            self.assertEqual(summary["encoding"], "gaussian")
            self.assertEqual(summary["vertex_count"], len(splats))

    def test_spark_build_lod_prefers_workspace_binary(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            binary_path = temp_path / "spark" / "rust" / "target" / "release" / "build-lod"
            input_path = temp_path / "input.ply"
            binary_path.parent.mkdir(parents=True)
            binary_path.write_text("", encoding="utf-8")
            input_path.write_text("", encoding="utf-8")

            command = _build_lod_command(None, temp_path / "spark", input_path)

            self.assertEqual(command, [str(binary_path), str(input_path)])

    def test_spark_build_lod_falls_back_to_npm_script(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "input.ply"
            input_path.write_text("", encoding="utf-8")

            with patch("tools.spark_build_lod.shutil.which", return_value=None):
                command = _build_lod_command(None, temp_path / "spark", input_path)

            self.assertEqual(command, ["npm", "run", "build-lod", "--", str(input_path)])


def _write_triangle_glb(path: Path) -> None:
    positions = struct.pack(
        "<9f",
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
    )
    indices = struct.pack("<3H", 0, 1, 2)
    binary = _pad4(positions) + _pad4(indices)
    document = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{
            "primitives": [{
                "attributes": {"POSITION": 0},
                "indices": 1,
                "material": 0,
            }],
        }],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1.0, 0.0, 0.0, 1.0]}}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(positions)},
            {"buffer": 0, "byteOffset": len(_pad4(positions)), "byteLength": len(indices)},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
            {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"},
        ],
    }
    json_chunk = _pad4(json.dumps(document, separators=(",", ":")).encode("utf-8"), pad_byte=b" ")
    bin_chunk = _pad4(binary)
    total_length = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    with path.open("wb") as file:
        file.write(b"glTF")
        file.write(struct.pack("<II", 2, total_length))
        file.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))
        file.write(json_chunk)
        file.write(struct.pack("<II", len(bin_chunk), 0x004E4942))
        file.write(bin_chunk)


def _pad4(data: bytes, *, pad_byte: bytes = b"\x00") -> bytes:
    return data + pad_byte * ((4 - len(data) % 4) % 4)


if __name__ == "__main__":
    unittest.main()
