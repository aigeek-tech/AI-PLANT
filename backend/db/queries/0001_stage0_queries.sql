-- 1. List standards with class and attribute counts.
SELECT
    s.code AS standard_code,
    s.name AS standard_name,
    COUNT(DISTINCT c.id)::int AS class_count,
    COUNT(DISTINCT ad.id)::int AS attribute_count
FROM standard s
LEFT JOIN class c ON c.standard_id = s.id
LEFT JOIN attribute_definition ad ON ad.class_id = c.id
GROUP BY s.id
ORDER BY s.code;

-- 2. List class definitions and attributes for one standard.
SELECT
    s.code AS standard_code,
    c.code AS class_code,
    c.name AS class_name,
    ad.code AS attribute_code,
    ad.name AS attribute_name,
    ad.sort_order AS attribute_sort_order,
    ad.value_type,
    ad.is_required
FROM standard s
JOIN class c ON c.standard_id = s.id
LEFT JOIN attribute_definition ad ON ad.class_id = c.id
WHERE s.code = 'DEC'
ORDER BY c.code, ad.sort_order, ad.code;

-- 3. Find required attributes by standard class.
SELECT
    s.code AS standard_code,
    c.code AS class_code,
    ad.code AS required_attribute_code,
    ad.name AS required_attribute_name
FROM standard s
JOIN class c ON c.standard_id = s.id
JOIN attribute_definition ad ON ad.class_id = c.id
WHERE ad.is_required = true
ORDER BY s.code, c.code, ad.code;
