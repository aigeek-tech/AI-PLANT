from __future__ import annotations

from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from tools._tag_equipment_check_cli import run_check  # noqa: E402
from tools.check_tag_equipment_attribute_issues import tag_attribute_problem_rows  # noqa: E402


def main() -> int:
    return run_check(
        description="Check tags whose attributes do not match their standard/common + class definitions",
        result_key="tag_attribute_problem_rows",
        rows_builder=tag_attribute_problem_rows,
    )


if __name__ == "__main__":
    raise SystemExit(main())
