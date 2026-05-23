from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Spark build-lod and normalize the RAD output path.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--spark-dir", default=os.getenv("SPARK_BUILD_LOD_DIR", "/opt/spark-cli"))
    parser.add_argument("--build-lod-bin", default=os.getenv("SPARK_BUILD_LOD_BIN"))
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--quality", action="store_true")
    parser.add_argument("--rad-chunked", action="store_true")
    parser.add_argument("--max-sh", type=int)
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    spark_dir = Path(args.spark_dir).resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)
    if not spark_dir.exists():
        raise FileNotFoundError(f"Spark build-lod directory not found: {spark_dir}")

    command = _build_lod_command(args.build_lod_bin, spark_dir, input_path)
    if args.quality:
        command.append("--quality")
    elif args.quick:
        command.append("--quick")
    if args.max_sh is not None:
        command.append(f"--max-sh={args.max_sh}")
    if args.rad_chunked:
        command.append("--rad-chunked")

    completed = subprocess.run(command, cwd=spark_dir, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(stderr or f"Spark build-lod failed with exit code {completed.returncode}")

    generated_path = input_path.with_name(f"{input_path.stem}-lod.rad")
    if not generated_path.exists() or generated_path.stat().st_size <= 0:
        raise RuntimeError(f"Spark build-lod did not create {generated_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if generated_path != output_path:
        shutil.move(str(generated_path), str(output_path))
    return 0


def _build_lod_command(configured_binary: str | None, spark_dir: Path, input_path: Path) -> list[str]:
    candidates = []
    if configured_binary:
        candidates.append(Path(configured_binary))
    candidates.append(spark_dir / "rust" / "target" / "release" / "build-lod")
    candidates.append(spark_dir / "rust" / "build-lod" / "target" / "release" / "build-lod")

    for candidate in candidates:
        if candidate.exists():
            return [str(candidate), str(input_path)]

    resolved = shutil.which("build-lod")
    if resolved:
        return [resolved, str(input_path)]

    return ["npm", "run", "build-lod", "--", str(input_path)]


if __name__ == "__main__":
    raise SystemExit(main())
