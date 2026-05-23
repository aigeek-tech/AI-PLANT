--
-- Store configurable equipment attributes separately from core asset identity.
--

ALTER TABLE public.equipment
    ADD COLUMN IF NOT EXISTS attribute_values jsonb DEFAULT '{}'::jsonb NOT NULL;

COMMENT ON COLUMN public.equipment.attribute_values IS 'Project equipment attribute values keyed by standard equipment attribute code.';

CREATE INDEX IF NOT EXISTS equipment_attribute_values_gin_idx
    ON public.equipment USING gin (attribute_values jsonb_path_ops);
