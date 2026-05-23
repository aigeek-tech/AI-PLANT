--
-- Keep equipment attribute_values aligned with active equipment standard attributes.
--
-- Earlier demo completion copied tag attribute values into equipment records. That
-- made equipment carry tag-only attribute codes. This migration preserves only
-- active standard/class attributes whose applies_to is equipment or both.
--

WITH allowed_attribute_codes AS (
    SELECT
        e.id AS equipment_id,
        array_agg(DISTINCT ad.code) FILTER (WHERE ad.code IS NOT NULL) AS codes
    FROM public.equipment e
    JOIN public.project p ON p.id = e.project_id
    LEFT JOIN public.attribute_definition ad
        ON ad.status <> 'archived'
       AND ad.applies_to IN ('equipment', 'both')
       AND (
            (
                p.reference_attributes ? 'standard_id'
                AND ad.standard_id = (p.reference_attributes ->> 'standard_id')::uuid
            )
            OR ad.class_id = e.class_id
       )
    WHERE e.asset_status <> 'archived'
    GROUP BY e.id
),
normalized_attribute_values AS (
    SELECT
        e.id AS equipment_id,
        COALESCE(
            jsonb_object_agg(attribute.key, attribute.value)
                FILTER (
                    WHERE attribute.key = ANY(COALESCE(allowed.codes, ARRAY[]::text[]))
                ),
            '{}'::jsonb
        ) AS attribute_values
    FROM public.equipment e
    JOIN allowed_attribute_codes allowed ON allowed.equipment_id = e.id
    LEFT JOIN LATERAL jsonb_each(COALESCE(e.attribute_values, '{}'::jsonb)) AS attribute(key, value)
        ON true
    WHERE e.asset_status <> 'archived'
    GROUP BY e.id
)
UPDATE public.equipment e
SET
    attribute_values = normalized.attribute_values,
    metadata = e.metadata || jsonb_build_object(
        'attribute_values_normalized_by', '0016_strict_equipment_attribute_values'
    )
FROM normalized_attribute_values normalized
WHERE normalized.equipment_id = e.id
  AND e.attribute_values IS DISTINCT FROM normalized.attribute_values;
