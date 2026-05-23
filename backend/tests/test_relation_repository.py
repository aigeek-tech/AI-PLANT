import unittest

from app.relation_repository import _canonicalize_relation_endpoints


class RelationRepositoryTest(unittest.TestCase):
    def test_keeps_non_symmetric_relation_order(self):
        relation_type = {"is_symmetric": False}

        result = _canonicalize_relation_endpoints(relation_type, "document", "doc-2", "tag", "tag-1")

        self.assertEqual(result, ("document", "doc-2", "tag", "tag-1"))

    def test_canonicalizes_symmetric_relation_order(self):
        relation_type = {"is_symmetric": True}

        result = _canonicalize_relation_endpoints(relation_type, "tag", "tag-9", "tag", "tag-1")

        self.assertEqual(result, ("tag", "tag-1", "tag", "tag-9"))


if __name__ == "__main__":
    unittest.main()
