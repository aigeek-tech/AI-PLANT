from pathlib import Path
import unittest


MIGRATION_PATH = Path(__file__).resolve().parents[1] / "db" / "migrations" / "0008_discipline_document_requirements.sql"
DOCKER_COMPOSE = Path(__file__).resolve().parents[2] / "docker-compose.yml"


class StandardRulesMigrationTest(unittest.TestCase):
    def test_migration_defines_discipline_rule_tables_and_constraints(self):
        content = MIGRATION_PATH.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE IF NOT EXISTS public.discipline", content)
        self.assertIn("CREATE TABLE IF NOT EXISTS public.discipline_document_type", content)
        self.assertIn("CREATE TABLE IF NOT EXISTS public.class_document_requirement", content)
        self.assertIn("discipline_standard_code_uidx", content)
        self.assertIn("discipline_standard_cfihos_uidx", content)
        self.assertIn("discipline_document_type_business_uidx", content)
        self.assertIn("class_document_requirement_business_uidx", content)
        self.assertIn("'discipline_document_type'::text", content)
        self.assertIn("'class_document_requirement'::text", content)

    def test_docker_compose_applies_rules_migration_after_agent_harness(self):
        content = DOCKER_COMPOSE.read_text(encoding="utf-8")

        self.assertIn("./backend/db/migrations/0008_discipline_document_requirements.sql", content)
        self.assertLess(
            content.index("./backend/db/migrations/0007_agent_harness.sql"),
            content.index("./backend/db/migrations/0008_discipline_document_requirements.sql"),
        )


if __name__ == "__main__":
    unittest.main()
