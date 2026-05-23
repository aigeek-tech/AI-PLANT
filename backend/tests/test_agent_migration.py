from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = REPO_ROOT / "backend" / "db" / "migrations" / "0004_agent_jobs.sql"
HARNESS_MIGRATION = REPO_ROOT / "backend" / "db" / "migrations" / "0007_agent_harness.sql"
DOCKER_COMPOSE = REPO_ROOT / "docker-compose.yml"


class AgentMigrationTest(unittest.TestCase):
    def test_agent_job_migration_defines_required_tables_and_status_checks(self):
        content = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE public.agent_job", content)
        self.assertIn("CREATE TABLE public.agent_job_event", content)
        self.assertIn("CREATE TABLE public.agent_artifact", content)
        self.assertIn("agent_job_status_check", content)
        for status in ("queued", "running", "completed", "failed", "cancelled"):
            self.assertIn(f"'{status}'::text", content)
        self.assertIn("agent_job_task_type_check", content)
        self.assertIn("agent_job_event_seq_key", content)

    def test_agent_job_migration_adds_reviewable_indexes(self):
        content = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("agent_job_project_status_created_by_created_at_idx", content)
        self.assertIn("agent_job_event_job_id_seq_idx", content)
        self.assertIn("agent_artifact_job_id_created_at_idx", content)

    def test_docker_compose_applies_agent_migration_after_existing_incrementals(self):
        content = DOCKER_COMPOSE.read_text(encoding="utf-8")

        self.assertIn("./backend/db/migrations/0004_agent_jobs.sql", content)
        self.assertLess(
            content.index("./backend/db/migrations/0003_equipment_implementation.sql"),
            content.index("./backend/db/migrations/0004_agent_jobs.sql"),
        )

    def test_agent_harness_migration_defines_global_session_run_event_tables(self):
        content = HARNESS_MIGRATION.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE public.agent_session", content)
        self.assertIn("CREATE TABLE public.agent_message", content)
        self.assertIn("CREATE TABLE public.agent_run", content)
        self.assertIn("CREATE TABLE public.agent_run_event", content)
        self.assertIn("agent_run_context_scope_check", content)
        self.assertIn("agent_run_capability_profile_check", content)
        self.assertIn("'full_access'::text", content)
        self.assertIn("ALTER TABLE public.agent_artifact", content)
        self.assertIn("agent_artifact_run_id_fkey", content)

    def test_docker_compose_applies_harness_migration_after_agent_jobs(self):
        content = DOCKER_COMPOSE.read_text(encoding="utf-8")

        self.assertIn("./backend/db/migrations/0007_agent_harness.sql", content)
        self.assertLess(
            content.index("./backend/db/migrations/0004_agent_jobs.sql"),
            content.index("./backend/db/migrations/0007_agent_harness.sql"),
        )


if __name__ == "__main__":
    unittest.main()
