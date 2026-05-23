--
-- CFIHOS discipline and document requirement rule library.
--
-- The project document discipline text field remains unchanged. These tables
-- store standard-level delivery rules that can be imported, reviewed, and
-- queried without auto-generating project document registers.
--

ALTER TABLE public.standard_import_row DROP CONSTRAINT IF EXISTS standard_import_row_entity_kind_check;
ALTER TABLE public.standard_import_row
    ADD CONSTRAINT standard_import_row_entity_kind_check
    CHECK (
        entity_kind = ANY (
            ARRAY[
                'standard'::text,
                'pbs_level'::text,
                'tag_class'::text,
                'tag_attribute'::text,
                'equipment_class'::text,
                'equipment_attribute'::text,
                'tag_equipment_class_relationship'::text,
                'document_type'::text,
                'document_attribute'::text,
                'discipline'::text,
                'discipline_document_type'::text,
                'class_document_requirement'::text
            ]
        )
    );

CREATE TABLE IF NOT EXISTS public.discipline (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    standard_id uuid NOT NULL,
    cfihos_unique_code text,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discipline_pkey PRIMARY KEY (id),
    CONSTRAINT discipline_code_check CHECK (length(TRIM(BOTH FROM code)) > 0),
    CONSTRAINT discipline_name_check CHECK (length(TRIM(BOTH FROM name)) > 0),
    CONSTRAINT discipline_status_check CHECK (status = ANY (ARRAY['active'::text, 'deprecated'::text, 'archived'::text]))
);

COMMENT ON TABLE public.discipline IS 'Standard-level discipline catalog imported from CFIHOS or maintained per standard.';
COMMENT ON COLUMN public.discipline.cfihos_unique_code IS 'Original CFIHOS unique code for the discipline, when provided by the source.';

CREATE TABLE IF NOT EXISTS public.discipline_document_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    standard_id uuid NOT NULL,
    discipline_id uuid NOT NULL,
    document_type_id uuid NOT NULL,
    cfihos_unique_code text,
    short_code text,
    asset_scope text,
    representation_type text,
    native_file_delivery_timing text,
    perspective text DEFAULT 'standard'::text NOT NULL,
    lifecycle_phase text DEFAULT 'unspecified'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discipline_document_type_pkey PRIMARY KEY (id),
    CONSTRAINT discipline_document_type_perspective_check CHECK (length(TRIM(BOTH FROM perspective)) > 0),
    CONSTRAINT discipline_document_type_lifecycle_phase_check CHECK (length(TRIM(BOTH FROM lifecycle_phase)) > 0),
    CONSTRAINT discipline_document_type_status_check CHECK (status = ANY (ARRAY['active'::text, 'deprecated'::text, 'archived'::text]))
);

COMMENT ON TABLE public.discipline_document_type IS 'Standard rule declaring that a discipline is associated with a document type under a perspective and lifecycle context.';
COMMENT ON COLUMN public.discipline_document_type.asset_scope IS 'Normalized lowercase snake_case asset scope, with the source value retained in metadata.';
COMMENT ON COLUMN public.discipline_document_type.perspective IS 'Normalized context such as standard, designer, owner, operator, or contractor.';
COMMENT ON COLUMN public.discipline_document_type.lifecycle_phase IS 'Normalized lifecycle context such as unspecified, project, handover, or not_applicable.';

CREATE TABLE IF NOT EXISTS public.class_document_requirement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    standard_id uuid NOT NULL,
    class_id uuid NOT NULL,
    document_type_id uuid NOT NULL,
    cfihos_unique_code text,
    asset_scope text,
    source_standard_cfihos_code text,
    source_standard_code text,
    perspective text DEFAULT 'standard'::text NOT NULL,
    lifecycle_phase text DEFAULT 'unspecified'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_document_requirement_pkey PRIMARY KEY (id),
    CONSTRAINT class_document_requirement_perspective_check CHECK (length(TRIM(BOTH FROM perspective)) > 0),
    CONSTRAINT class_document_requirement_lifecycle_phase_check CHECK (length(TRIM(BOTH FROM lifecycle_phase)) > 0),
    CONSTRAINT class_document_requirement_status_check CHECK (status = ANY (ARRAY['active'::text, 'deprecated'::text, 'archived'::text]))
);

COMMENT ON TABLE public.class_document_requirement IS 'Standard rule declaring that a tag/equipment class requires a document type under a perspective and lifecycle context.';
COMMENT ON COLUMN public.class_document_requirement.asset_scope IS 'Normalized lowercase snake_case asset scope, with the source value retained in metadata.';

ALTER TABLE ONLY public.discipline
    DROP CONSTRAINT IF EXISTS discipline_standard_id_fkey;
ALTER TABLE ONLY public.discipline
    ADD CONSTRAINT discipline_standard_id_fkey
    FOREIGN KEY (standard_id) REFERENCES public.standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.discipline_document_type
    DROP CONSTRAINT IF EXISTS discipline_document_type_standard_id_fkey;
ALTER TABLE ONLY public.discipline_document_type
    ADD CONSTRAINT discipline_document_type_standard_id_fkey
    FOREIGN KEY (standard_id) REFERENCES public.standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.discipline_document_type
    DROP CONSTRAINT IF EXISTS discipline_document_type_discipline_id_fkey;
ALTER TABLE ONLY public.discipline_document_type
    ADD CONSTRAINT discipline_document_type_discipline_id_fkey
    FOREIGN KEY (discipline_id) REFERENCES public.discipline(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.discipline_document_type
    DROP CONSTRAINT IF EXISTS discipline_document_type_document_type_id_fkey;
ALTER TABLE ONLY public.discipline_document_type
    ADD CONSTRAINT discipline_document_type_document_type_id_fkey
    FOREIGN KEY (document_type_id) REFERENCES public.class(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.class_document_requirement
    DROP CONSTRAINT IF EXISTS class_document_requirement_standard_id_fkey;
ALTER TABLE ONLY public.class_document_requirement
    ADD CONSTRAINT class_document_requirement_standard_id_fkey
    FOREIGN KEY (standard_id) REFERENCES public.standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.class_document_requirement
    DROP CONSTRAINT IF EXISTS class_document_requirement_class_id_fkey;
ALTER TABLE ONLY public.class_document_requirement
    ADD CONSTRAINT class_document_requirement_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES public.class(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.class_document_requirement
    DROP CONSTRAINT IF EXISTS class_document_requirement_document_type_id_fkey;
ALTER TABLE ONLY public.class_document_requirement
    ADD CONSTRAINT class_document_requirement_document_type_id_fkey
    FOREIGN KEY (document_type_id) REFERENCES public.class(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS discipline_standard_code_uidx
    ON public.discipline USING btree (standard_id, lower(code))
    WHERE (status <> 'archived'::text);

CREATE UNIQUE INDEX IF NOT EXISTS discipline_standard_cfihos_uidx
    ON public.discipline USING btree (standard_id, lower(cfihos_unique_code))
    WHERE (
        cfihos_unique_code IS NOT NULL
        AND length(TRIM(BOTH FROM cfihos_unique_code)) > 0
        AND status <> 'archived'::text
    );

CREATE INDEX IF NOT EXISTS discipline_standard_idx
    ON public.discipline USING btree (standard_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS discipline_document_type_standard_cfihos_uidx
    ON public.discipline_document_type USING btree (standard_id, lower(cfihos_unique_code))
    WHERE (
        cfihos_unique_code IS NOT NULL
        AND length(TRIM(BOTH FROM cfihos_unique_code)) > 0
        AND status <> 'archived'::text
    );

CREATE UNIQUE INDEX IF NOT EXISTS discipline_document_type_business_uidx
    ON public.discipline_document_type USING btree (
        standard_id,
        discipline_id,
        document_type_id,
        COALESCE(lower(asset_scope), ''::text),
        COALESCE(lower(representation_type), ''::text),
        COALESCE(lower(native_file_delivery_timing), ''::text),
        lower(perspective),
        lower(lifecycle_phase)
    )
    WHERE (status <> 'archived'::text);

CREATE INDEX IF NOT EXISTS discipline_document_type_standard_idx
    ON public.discipline_document_type USING btree (standard_id, status);

CREATE INDEX IF NOT EXISTS discipline_document_type_discipline_idx
    ON public.discipline_document_type USING btree (discipline_id);

CREATE INDEX IF NOT EXISTS discipline_document_type_document_type_idx
    ON public.discipline_document_type USING btree (document_type_id);

CREATE INDEX IF NOT EXISTS discipline_document_type_context_idx
    ON public.discipline_document_type USING btree (standard_id, asset_scope, perspective, lifecycle_phase);

CREATE UNIQUE INDEX IF NOT EXISTS class_document_requirement_standard_cfihos_uidx
    ON public.class_document_requirement USING btree (standard_id, lower(cfihos_unique_code))
    WHERE (
        cfihos_unique_code IS NOT NULL
        AND length(TRIM(BOTH FROM cfihos_unique_code)) > 0
        AND status <> 'archived'::text
    );

CREATE UNIQUE INDEX IF NOT EXISTS class_document_requirement_business_uidx
    ON public.class_document_requirement USING btree (
        standard_id,
        class_id,
        document_type_id,
        COALESCE(lower(asset_scope), ''::text),
        COALESCE(lower(source_standard_code), ''::text),
        lower(perspective),
        lower(lifecycle_phase)
    )
    WHERE (status <> 'archived'::text);

CREATE INDEX IF NOT EXISTS class_document_requirement_standard_idx
    ON public.class_document_requirement USING btree (standard_id, status);

CREATE INDEX IF NOT EXISTS class_document_requirement_class_idx
    ON public.class_document_requirement USING btree (class_id);

CREATE INDEX IF NOT EXISTS class_document_requirement_document_type_idx
    ON public.class_document_requirement USING btree (document_type_id);

CREATE INDEX IF NOT EXISTS class_document_requirement_context_idx
    ON public.class_document_requirement USING btree (standard_id, asset_scope, perspective, lifecycle_phase);

DROP TRIGGER IF EXISTS discipline_set_updated_at ON public.discipline;
CREATE TRIGGER discipline_set_updated_at BEFORE UPDATE ON public.discipline
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS discipline_document_type_set_updated_at ON public.discipline_document_type;
CREATE TRIGGER discipline_document_type_set_updated_at BEFORE UPDATE ON public.discipline_document_type
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS class_document_requirement_set_updated_at ON public.class_document_requirement;
CREATE TRIGGER class_document_requirement_set_updated_at BEFORE UPDATE ON public.class_document_requirement
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
