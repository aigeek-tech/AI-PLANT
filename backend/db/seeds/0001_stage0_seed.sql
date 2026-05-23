BEGIN;

INSERT INTO standard (id, code, name, version_label, thumbnail_url, status, metadata)
VALUES
    ('55555555-5555-5555-5555-555555555001', 'DEC', 'DEC Engineering Standards', '2024.1', NULL, 'active', '{}'),
    ('55555555-5555-5555-5555-555555555002', 'GB', 'National GB Standards', '2023.0', NULL, 'active', '{}');

INSERT INTO class (id, standard_id, code, name, parent_id, level_no, description, status, metadata)
VALUES
    ('33333333-3333-3333-3333-333333333001', '55555555-5555-5555-5555-555555555001', 'PUMP', 'Pump', NULL, 1, 'Rotating equipment pump class.', 'active', '{}'),
    ('33333333-3333-3333-3333-333333333002', '55555555-5555-5555-5555-555555555001', 'VALVE', 'Valve', NULL, 1, 'Isolation and control valve class.', 'active', '{}'),
    ('33333333-3333-3333-3333-333333333003', '55555555-5555-5555-5555-555555555001', 'INSTRUMENT', 'Instrument', NULL, 1, 'Field and panel instrumentation class.', 'active', '{}'),
    ('33333333-3333-3333-3333-333333333004', '55555555-5555-5555-5555-555555555002', 'PIPE', 'Pipe', NULL, 1, 'Pipe class definition.', 'active', '{}');

INSERT INTO attribute_definition (id, class_id, code, name, value_type, is_required, unit_family, enum_options, description, sort_order, status, metadata)
VALUES
    ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333001', 'tag_no', 'Tag Number', 'string', true, NULL, '[]', 'Primary equipment or device tag.', 0, 'active', '{}'),
    ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333001', 'flow_rate', 'Flow Rate', 'number', false, 'flow', '[]', 'Nominal design flow rate.', 1, 'active', '{}'),
    ('44444444-4444-4444-4444-444444444003', '33333333-3333-3333-3333-333333333001', 'driver_type', 'Driver Type', 'enum', false, NULL, '["motor","steam_turbine","diesel"]', 'Pump driver type.', 2, 'active', '{}'),
    ('44444444-4444-4444-4444-444444444006', '33333333-3333-3333-3333-333333333002', 'valve_type', 'Valve Type', 'enum', false, NULL, '["gate","globe","ball","control"]', 'Valve subtype.', 0, 'active', '{}'),
    ('44444444-4444-4444-4444-444444444008', '33333333-3333-3333-3333-333333333003', 'signal_type', 'Signal Type', 'enum', false, NULL, '["4_20mA","hart","foundation_fieldbus","digital_input"]', 'Instrumentation signal type.', 0, 'active', '{}'),
    ('44444444-4444-4444-4444-444444444010', '33333333-3333-3333-3333-333333333004', 'nominal_diameter', 'Nominal Diameter', 'number', true, 'length', '[]', 'Nominal pipe diameter.', 0, 'active', '{}');

COMMIT;
