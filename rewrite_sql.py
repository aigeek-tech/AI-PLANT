import re
import os
import codecs

SCHEMA_FILE = 'd:/ai-geek/smart_design/backend/db/migrations/0001_stage0_schema.sql'

with codecs.open(SCHEMA_FILE, 'r', encoding='utf-8') as f:

    schema = f.read()

new_tables = """
CREATE TABLE standard (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL,
    name text NOT NULL,
    version_label text,
    thumbnail_url text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (code)
);

CREATE TABLE class (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_id uuid NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    parent_id uuid REFERENCES class(id) ON DELETE SET NULL,
    level_no integer NOT NULL DEFAULT 1 CHECK (level_no > 0),
    description text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (standard_id, code)
);

CREATE TABLE attribute_definition (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id uuid NOT NULL REFERENCES class(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    value_type text NOT NULL CHECK (value_type IN ('string', 'number', 'integer', 'boolean', 'date', 'enum', 'json')),
    is_required boolean NOT NULL DEFAULT false,
    unit_family text,
    enum_options jsonb NOT NULL DEFAULT '[]'::jsonb,
    description text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (class_id, code)
);

CREATE TABLE project_standard_binding (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    standard_id uuid NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
    discipline_id uuid REFERENCES discipline(id) ON DELETE SET NULL,
    class_id uuid REFERENCES class(id) ON DELETE SET NULL,
    is_default boolean NOT NULL DEFAULT false,
    effective_from date,
    effective_to date,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, standard_id, discipline_id, class_id)
);

CREATE TABLE project_standard_override (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    standard_id uuid NOT NULL REFERENCES standard(id) ON DELETE CASCADE,
    override_type text NOT NULL CHECK (override_type IN ('replace', 'append', 'waive')),
    target_class_id uuid REFERENCES class(id) ON DELETE SET NULL,
    reason_text text NOT NULL,
    approved_by text,
    approved_at timestamptz,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'archived')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
"""

# Find the block from `CREATE TABLE class (` to `CREATE TABLE object (` and replace it.
pattern = re.compile(r'CREATE TABLE class \(.*?CREATE TABLE object \(', re.DOTALL)
schema = pattern.sub(new_tables + "\nCREATE TABLE object (", schema)

# Then we need to fix `class_definition_id` inside object
schema = re.sub(r'\n\s+class_definition_id uuid REFERENCES class_definition\(id\) ON DELETE SET NULL,', '', schema)

# rule_definition has linked_clause_id
schema = re.sub(r'\n\s+linked_clause_id uuid REFERENCES standard_clause\(id\) ON DELETE SET NULL,', '', schema)

# rule_binding has standard_profile_id, replace with standard_id
schema = re.sub(r'standard_profile_id uuid NOT NULL REFERENCES standard_profile\(id\) ON DELETE CASCADE', 'standard_id uuid NOT NULL REFERENCES standard(id) ON DELETE CASCADE', schema)
schema = schema.replace('UNIQUE (rule_definition_id, standard_profile_id)', 'UNIQUE (rule_definition_id, standard_id)')

# Fix indices
indices_to_remove = [
    'CREATE INDEX class_discipline_parent_idx ON class (discipline_id, parent_id);',
    'CREATE INDEX standard_document_subject_idx ON standard_document (discipline_id, subject_class_id);',
    'CREATE INDEX standard_clause_text_fts_idx ON standard_clause USING gin (to_tsvector(\'simple\', clause_text));',
    'CREATE INDEX standard_profile_item_priority_idx ON standard_profile_item (standard_profile_id, priority_no);',
    'CREATE INDEX class_definition_class_status_idx ON class_definition (class_id, status);',
    'CREATE INDEX class_definition_profile_class_idx ON class_definition (standard_profile_id, class_id);',
    'CREATE INDEX class_attribute_definition_order_idx ON class_attribute (class_definition_id, order_no);',
    'CREATE INDEX project_standard_binding_lookup_idx ON project_standard_binding (project_id, discipline_id, class_id);',
    'CREATE INDEX rule_binding_profile_priority_idx ON rule_binding (standard_profile_id, priority_no);'
]

new_indices = """CREATE INDEX class_standard_parent_idx ON class (standard_id, parent_id);
CREATE INDEX attribute_definition_class_idx ON attribute_definition (class_id);
CREATE INDEX project_standard_binding_lookup_idx ON project_standard_binding (project_id, standard_id, class_id);
CREATE INDEX rule_binding_profile_priority_idx ON rule_binding (standard_id, priority_no);"""

for idx in indices_to_remove:
    schema = schema.replace(idx + '\n', '')
    schema = schema.replace(idx, '')

schema = schema.replace('CREATE INDEX attribute_definition_enum_options_gin ON attribute_definition USING gin (enum_options jsonb_path_ops);\n', 
                        'CREATE INDEX attribute_definition_enum_options_gin ON attribute_definition USING gin (enum_options jsonb_path_ops);\n' + new_indices + '\n')


# Fix triggers
triggers_to_remove = [
    'CREATE TRIGGER standard_system_set_updated_at BEFORE UPDATE ON standard_system FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    'CREATE TRIGGER standard_document_set_updated_at BEFORE UPDATE ON standard_document FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    'CREATE TRIGGER standard_release_set_updated_at BEFORE UPDATE ON standard_release FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    'CREATE TRIGGER standard_clause_set_updated_at BEFORE UPDATE ON standard_clause FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    'CREATE TRIGGER standard_profile_set_updated_at BEFORE UPDATE ON standard_profile FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    'CREATE TRIGGER standard_profile_item_set_updated_at BEFORE UPDATE ON standard_profile_item FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    'CREATE TRIGGER class_definition_set_updated_at BEFORE UPDATE ON class_definition FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    'CREATE TRIGGER class_attribute_set_updated_at BEFORE UPDATE ON class_attribute FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
]

new_trigger = 'CREATE TRIGGER standard_set_updated_at BEFORE UPDATE ON standard FOR EACH ROW EXECUTE FUNCTION set_updated_at();\n'

schema = schema.replace('CREATE TRIGGER class_set_updated_at BEFORE UPDATE ON class FOR EACH ROW EXECUTE FUNCTION set_updated_at();\n',
                        new_trigger + 'CREATE TRIGGER class_set_updated_at BEFORE UPDATE ON class FOR EACH ROW EXECUTE FUNCTION set_updated_at();\n')

for trg in triggers_to_remove:
    schema = schema.replace(trg + '\n', '')

# Fix comments
comments_to_remove = [
    "COMMENT ON TABLE class IS 'Object categories such as pump, valve, and instrument.';",
    "COMMENT ON TABLE class_definition IS 'Versioned class templates under a standard profile context.';",
    "COMMENT ON TABLE class_attribute IS 'Attribute settings for a given class definition.';",
    "COMMENT ON TABLE standard_profile IS 'Active standard composition used by a project or organization.';",
    "COMMENT ON TABLE project_standard_override IS 'Project-specific standard replacement, append, or waive records.';"
]
new_comments = """COMMENT ON TABLE standard IS 'Top-level standard definition like GB or DEC.';
COMMENT ON TABLE class IS 'Object categories belonging to a specific standard.';
COMMENT ON TABLE attribute_definition IS 'Attributes owned by a specific class.';
COMMENT ON TABLE project_standard_override IS 'Project-specific standard overrides.';"""

schema = schema.replace("COMMENT ON TABLE class IS 'Object categories such as pump, valve, and instrument.';", new_comments)
for cmt in comments_to_remove[1:]:
    schema = schema.replace(cmt + '\n', '')


with codecs.open(SCHEMA_FILE, 'w', encoding='utf-8') as f:
    f.write(schema)

print("Schema file rewritten.")
