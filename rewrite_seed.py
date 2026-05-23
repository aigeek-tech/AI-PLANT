import codecs

SEED_FILE = 'd:/ai-geek/smart_design/backend/db/seeds/0001_stage0_seed.sql'

new_seed = """BEGIN;

INSERT INTO project (id, code, name, owner_name, project_type, phase, status, location, metadata)
VALUES
    ('11111111-1111-1111-1111-111111111001', 'PRJ-HABSHAN-FEED', 'Habshan Gas Complex FEED', 'National Gas Owner', 'gas_processing', 'FEED', 'active', 'Abu Dhabi', '{"region":"mena","priority":"pilot"}'),
    ('11111111-1111-1111-1111-111111111002', 'PRJ-OFFSHORE-BROWNFIELD', 'Offshore Brownfield Upgrade', 'Offshore Energy Owner', 'offshore_upgrade', 'Detailed Design', 'active', 'Offshore Island', '{"region":"mena","priority":"pilot"}'),
    ('11111111-1111-1111-1111-111111111003', 'PRJ-LNG-EXPANSION', 'LNG Expansion Train 2', 'LNG Operator', 'lng', 'FEED', 'active', 'Ruwais', '{"region":"mena","priority":"pilot"}');

INSERT INTO discipline (id, code, name, sort_order, metadata)
VALUES
    ('22222222-2222-2222-2222-222222222001', 'PROCESS', 'Process', 10, '{}'),
    ('22222222-2222-2222-2222-222222222002', 'PIPING', 'Piping', 20, '{}'),
    ('22222222-2222-2222-2222-222222222003', 'INSTRUMENTATION', 'Instrumentation', 30, '{}');

INSERT INTO project_discipline (id, project_id, discipline_id, status, metadata)
VALUES
    ('23333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111001', '22222222-2222-2222-2222-222222222001', 'active', '{}'),
    ('23333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111001', '22222222-2222-2222-2222-222222222002', 'active', '{}'),
    ('23333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111001', '22222222-2222-2222-2222-222222222003', 'active', '{}');

INSERT INTO standard (id, code, name, version_label, thumbnail_url, status, metadata)
VALUES
    ('55555555-5555-5555-5555-555555555001', 'DEC', 'DEC Engineering Standards', '2024.1', NULL, 'active', '{}'),
    ('55555555-5555-5555-5555-555555555002', 'GB', 'National GB Standards', '2023.0', NULL, 'active', '{}');

INSERT INTO class (id, standard_id, code, name, discipline_id, level_no, description, status, metadata)
VALUES
    ('33333333-3333-3333-3333-333333333001', '55555555-5555-5555-5555-555555555001', 'PUMP', 'Pump', '22222222-2222-2222-2222-222222222001', 1, 'Rotating equipment pump class.', 'active', '{}'),
    ('33333333-3333-3333-3333-333333333002', '55555555-5555-5555-5555-555555555001', 'VALVE', 'Valve', '22222222-2222-2222-2222-222222222002', 1, 'Isolation and control valve class.', 'active', '{}'),
    ('33333333-3333-3333-3333-333333333003', '55555555-5555-5555-5555-555555555001', 'INSTRUMENT', 'Instrument', '22222222-2222-2222-2222-222222222003', 1, 'Field and panel instrumentation class.', 'active', '{}');

INSERT INTO attribute_definition (id, class_id, code, name, value_type, is_required, unit_family, enum_options, description, status, metadata)
VALUES
    ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333001', 'tag_no', 'Tag Number', 'string', true, NULL, '[]', 'Primary equipment or device tag.', 'active', '{}'),
    ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333001', 'flow_rate', 'Flow Rate', 'number', false, 'flow', '[]', 'Nominal design flow rate.', 'active', '{}'),
    ('44444444-4444-4444-4444-444444444003', '33333333-3333-3333-3333-333333333001', 'driver_type', 'Driver Type', 'enum', false, NULL, '["motor","steam_turbine","diesel"]', 'Pump driver type.', 'active', '{}'),
    ('44444444-4444-4444-4444-444444444006', '33333333-3333-3333-3333-333333333002', 'valve_type', 'Valve Type', 'enum', false, NULL, '["gate","globe","ball","control"]', 'Valve subtype.', 'active', '{}'),
    ('44444444-4444-4444-4444-444444444008', '33333333-3333-3333-3333-333333333003', 'signal_type', 'Signal Type', 'enum', false, NULL, '["4_20mA","hart","foundation_fieldbus","digital_input"]', 'Instrumentation signal type.', 'active', '{}');

INSERT INTO document (id, project_id, discipline_id, doc_code, title, doc_type, source_system, status, metadata)
VALUES
    ('66666666-6666-6666-6666-666666666001', '11111111-1111-1111-1111-111111111001', '22222222-2222-2222-2222-222222222001', 'DOC-PID-1001', 'Crude Transfer P and ID', 'dwg', 'legacy_archive', 'active', '{"source_format":"dwg"}'),
    ('66666666-6666-6666-6666-666666666002', '11111111-1111-1111-1111-111111111001', '22222222-2222-2222-2222-222222222001', 'DOC-DS-2001', 'Pump Data Sheet P-101A', 'xlsx', 'legacy_archive', 'active', '{"source_format":"xlsx"}');

INSERT INTO document_version (id, document_id, revision_no, version_label, file_name, file_ext, mime_type, object_store_bucket, object_store_key, file_size, checksum_sha256, parser_profile, ocr_status, extraction_status, uploaded_by, uploaded_at, metadata)
VALUES
    ('77777777-7777-7777-7777-777777777001', '66666666-6666-6666-6666-666666666001', 1, 'REV-0', 'crude-transfer-pid.dwg', 'dwg', 'application/acad', 'smart-design-raw', 'habshan/pid/crude-transfer-pid-rev0.dwg', 5242880, 'sha256-dwg-001', 'dwg_default', 'not_applicable', 'completed', 'seed_loader', now(), '{"sheet_count":1}');

UPDATE document SET current_version_id = '77777777-7777-7777-7777-777777777001' WHERE id = '66666666-6666-6666-6666-666666666001';

INSERT INTO project_standard_binding (id, project_id, standard_id, discipline_id, class_id, is_default, effective_from, metadata)
VALUES
    ('12121212-1212-1212-1212-121212121201', '11111111-1111-1111-1111-111111111001', '55555555-5555-5555-5555-555555555001', '22222222-2222-2222-2222-222222222001', '33333333-3333-3333-3333-333333333001', true, DATE '2024-01-15', '{}');

INSERT INTO object (id, project_id, discipline_id, class_id, object_code, name, identity_hash, current_revision_no, current_attributes, review_state, lifecycle_state, confidence_score, first_document_id, last_document_id, status, metadata)
VALUES
    ('14141414-1414-1414-1414-141414141401', '11111111-1111-1111-1111-111111111001', '22222222-2222-2222-2222-222222222001', '33333333-3333-3333-3333-333333333001', 'P-101A', 'Crude Transfer Pump P-101A', 'pump|PRJ-HABSHAN-FEED|P-101A', 1, '{"tag_no":{"value":"P-101A"},"flow_rate":{"value":120,"unit":"m3/h"},"driver_type":{"value":"motor"}}', 'approved', 'active', 0.9800, '66666666-6666-6666-6666-666666666001', '66666666-6666-6666-6666-666666666002', 'active', '{}');

INSERT INTO object_relation (id, project_id, from_object_id, relation_type, to_object_id, relation_attributes, source_document_version_id, confidence_score, status, metadata)
VALUES
    ('17171717-1717-1717-1717-171717171701', '11111111-1111-1111-1111-111111111001', '14141414-1414-1414-1414-141414141401', 'connected_to', '14141414-1414-1414-1414-141414141401', '{"line_no":"12-P-1001"}', '77777777-7777-7777-7777-777777777001', 0.9100, 'active', '{}');

INSERT INTO rule_definition (id, code, name, rule_type, target_class_id, target_attribute_definition_id, expression_json, severity, status, metadata)
VALUES
    ('18181818-1818-1818-1818-181818181801', 'RULE-PUMP-DRIVER-CRITICAL', 'Critical pumps must use motor', 'cross_attribute', '33333333-3333-3333-3333-333333333001', '44444444-4444-4444-4444-444444444003', '{"allowed_values":["motor"]}', 'error', 'active', '{}');

INSERT INTO rule_binding (id, rule_definition_id, standard_id, priority_no, applicability_json, status, metadata)
VALUES
    ('19191919-1919-1919-1919-191919191901', '18181818-1818-1818-1818-181818181801', '55555555-5555-5555-5555-555555555001', 10, '{"class_codes":["PUMP"]}', 'active', '{}');

COMMIT;
"""

with codecs.open(SEED_FILE, 'w', encoding='utf-8') as f:
    f.write(new_seed)

print("Seed file rewritten.")
