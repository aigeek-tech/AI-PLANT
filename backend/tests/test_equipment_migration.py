from pathlib import Path
import unittest


MIGRATION_PATH = Path(__file__).resolve().parents[1] / "db" / "migrations" / "0003_equipment_implementation.sql"
ATTRIBUTE_VALUES_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "db" / "migrations" / "0009_equipment_attribute_values.sql"
)
STRICT_ATTRIBUTE_VALUES_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "db" / "migrations" / "0016_strict_equipment_attribute_values.sql"
)


class EquipmentMigrationTest(unittest.TestCase):
    def test_equipment_migration_defines_core_tables_and_constraints(self):
        content = MIGRATION_PATH.read_text(encoding="utf-8")

        self.assertNotIn("CREATE TABLE IF NOT EXISTS public.equipment_class", content)
        self.assertNotIn("CREATE TABLE IF NOT EXISTS public.equipment_attribute_definition", content)
        self.assertIn("'equipment'::text", content)
        self.assertIn("CREATE TABLE IF NOT EXISTS public.class_relationship", content)
        self.assertIn("relationship_type text NOT NULL", content)
        self.assertIn("CREATE TABLE IF NOT EXISTS public.equipment", content)
        self.assertIn("CREATE TABLE IF NOT EXISTS public.tag_equipment_assignment", content)
        self.assertIn("equipment_class_fkey FOREIGN KEY (class_id) REFERENCES public.class(id) ON DELETE RESTRICT", content)
        self.assertNotIn("equipment_class" + "_id", content)
        self.assertIn("equipment_project_no_uidx", content)
        self.assertIn("tag_equipment_assignment_current_tag_uidx", content)
        self.assertIn("tag_equipment_assignment_current_equipment_uidx", content)
        self.assertIn("ON DELETE RESTRICT", content)

    def test_equipment_attribute_values_migration_adds_jsonb_store(self):
        content = ATTRIBUTE_VALUES_MIGRATION_PATH.read_text(encoding="utf-8")

        self.assertIn("ALTER TABLE public.equipment", content)
        self.assertIn("ADD COLUMN IF NOT EXISTS attribute_values jsonb DEFAULT '{}'::jsonb NOT NULL", content)
        self.assertIn("equipment_attribute_values_gin_idx", content)

    def test_strict_equipment_attribute_values_migration_removes_standard_outside_keys(self):
        content = STRICT_ATTRIBUTE_VALUES_MIGRATION_PATH.read_text(encoding="utf-8")

        self.assertIn("0016_strict_equipment_attribute_values", content)
        self.assertIn("ad.applies_to IN ('equipment', 'both')", content)
        self.assertIn("jsonb_each(COALESCE(e.attribute_values, '{}'::jsonb))", content)
        self.assertIn("attribute.key = ANY(COALESCE(allowed.codes, ARRAY[]::text[]))", content)
        self.assertIn("e.attribute_values IS DISTINCT FROM normalized.attribute_values", content)


if __name__ == "__main__":
    unittest.main()
