from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "backend" / "db" / "migrations"
DOCKER_COMPOSE = REPO_ROOT / "docker-compose.yml"


class MigrationBaselineTest(unittest.TestCase):
    def test_migration_files_are_uniquely_numbered_and_ordered(self):
        migration_files = sorted(path.name for path in MIGRATIONS_DIR.glob("*.sql"))
        self.assertGreaterEqual(len(migration_files), 1)
        self.assertEqual(migration_files[0], "0001_full_schema.sql")

        numbers: list[int] = []
        for filename in migration_files:
            match = re.fullmatch(r"(\d{4})_[a-z0-9_]+\.sql", filename)
            self.assertIsNotNone(match, f"Invalid migration filename: {filename}")
            numbers.append(int(match.group(1)))

        self.assertEqual(numbers, sorted(numbers))
        self.assertEqual(len(numbers), len(set(numbers)))

    def test_docker_compose_bootstraps_from_baseline_and_current_incrementals(self):
        content = DOCKER_COMPOSE.read_text(encoding="utf-8")
        migration_files = sorted(path.name for path in MIGRATIONS_DIR.glob("*.sql"))
        self.assertIn("./backend/db/migrations/0001_full_schema.sql", content)
        self.assertNotIn("./backend/db/migrations:/docker-entrypoint-initdb.d", content)
        positions: list[int] = []
        for filename in migration_files:
            mounted_path = f"./backend/db/migrations/{filename}"
            self.assertIn(mounted_path, content)
            positions.append(content.index(mounted_path))
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("./backend/db/migrations/0005_project_schema.sql", content)
        self.assertNotIn("./backend/db/migrations/0021_rename_project_document_tables.sql", content)

    def test_baseline_includes_required_system_seed_data(self):
        content = (MIGRATIONS_DIR / "0001_full_schema.sql").read_text(encoding="utf-8")
        self.assertIn("INSERT INTO public.permission_definition", content)
        self.assertIn("'project.delete'", content)
        self.assertIn("INSERT INTO public.role_definition", content)
        self.assertIn("INSERT INTO public.role_permission", content)
        self.assertIn("INSERT INTO public.relation_type", content)


if __name__ == "__main__":
    unittest.main()
