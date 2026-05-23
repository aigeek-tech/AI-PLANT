import inspect
import unittest

import app.document_imports as document_imports
import app.document_repository as document_repository
import app.repository as repository_module
from app.relation_repository import _ENTITY_SQL


class DocumentTableNamingTest(unittest.TestCase):
    def test_relation_repository_uses_document_table_for_document_kind(self):
        self.assertEqual(_ENTITY_SQL["document"], "SELECT id FROM document WHERE project_id = %s AND id = %s")

    def test_document_import_queries_use_renamed_tables(self):
        source = inspect.getsource(document_imports)

        self.assertIn("FROM document pd", source)
        self.assertIn("LEFT JOIN document_revision pdr ON pdr.document_id = pd.id", source)
        self.assertNotIn("FROM project_document pd", source)
        self.assertNotIn("LEFT JOIN project_document_revision pdr ON pdr.document_id = pd.id", source)

    def test_document_repository_queries_use_renamed_tables(self):
        source = inspect.getsource(document_repository)

        required_patterns = [
            "FROM document d",
            "LEFT JOIN document_revision cr ON cr.id = d.current_revision_id",
            "FROM document_file pdf",
            "INSERT INTO document (",
            "UPDATE document",
            "INSERT INTO document_revision (",
            "UPDATE document_revision",
            "FROM document_revision",
            "INSERT INTO document_file (",
            "UPDATE document_file",
        ]
        forbidden_patterns = [
            "FROM project_document",
            "JOIN project_document ",
            "LEFT JOIN project_document",
            "INSERT INTO project_document",
            "UPDATE project_document",
            "FROM project_document_revision",
            "JOIN project_document_revision",
            "INSERT INTO project_document_revision",
            "UPDATE project_document_revision",
            "FROM project_document_file",
            "INSERT INTO project_document_file",
            "UPDATE project_document_file",
        ]

        for pattern in required_patterns:
            self.assertIn(pattern, source)

        for pattern in forbidden_patterns:
            self.assertNotIn(pattern, source)

    def test_project_delete_queries_use_renamed_document_tables(self):
        source = inspect.getsource(repository_module)

        self.assertIn("FROM document_file df", source)
        self.assertIn("JOIN document_revision dr ON dr.id = df.revision_id", source)
        self.assertIn("JOIN document d ON d.id = dr.document_id", source)
        self.assertNotIn("FROM project_document_file", source)
        self.assertNotIn("JOIN project_document_revision", source)
        self.assertNotIn("JOIN project_document pd", source)


if __name__ == "__main__":
    unittest.main()
