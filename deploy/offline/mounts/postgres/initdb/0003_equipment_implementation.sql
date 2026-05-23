--
-- Equipment implementation layer.
--
-- Tags remain stable functional requirements. Physical equipment is tracked
-- separately and typed by the existing standard class model.
--

ALTER TABLE public.class DROP CONSTRAINT IF EXISTS class_applies_to_check;
ALTER TABLE public.class
    ADD CONSTRAINT class_applies_to_check
    CHECK (applies_to = ANY (ARRAY['tag'::text, 'document'::text, 'equipment'::text, 'both'::text]));

COMMENT ON COLUMN public.class.applies_to IS 'Whether the standard class is intended for tag, document, equipment, or shared domains.';

ALTER TABLE public.attribute_definition DROP CONSTRAINT IF EXISTS attribute_definition_applies_to_check;
ALTER TABLE public.attribute_definition
    ADD CONSTRAINT attribute_definition_applies_to_check
    CHECK (applies_to = ANY (ARRAY['tag'::text, 'document'::text, 'equipment'::text, 'both'::text]));

COMMENT ON COLUMN public.attribute_definition.applies_to IS 'Whether the standard-level attribute applies to tags, documents, equipment, or shared domains.';

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
                'document_attribute'::text
            ]
        )
    );

CREATE TABLE IF NOT EXISTS public.class_relationship (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    standard_id uuid NOT NULL,
    source_class_id uuid NOT NULL,
    target_class_id uuid NOT NULL,
    relationship_type text NOT NULL,
    reason text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_relationship_pkey PRIMARY KEY (id),
    CONSTRAINT class_relationship_distinct_classes_check CHECK (source_class_id <> target_class_id),
    CONSTRAINT class_relationship_status_check CHECK (status = ANY (ARRAY['active'::text, 'archived'::text])),
    CONSTRAINT class_relationship_type_check CHECK (length(TRIM(BOTH FROM relationship_type)) > 0)
);

COMMENT ON TABLE public.class_relationship IS 'Standard-level relationships between classes, such as allowed tag-class to equipment-class implementations.';

CREATE TABLE IF NOT EXISTS public.equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    equipment_no text NOT NULL,
    name text NOT NULL,
    class_id uuid,
    manufacturer text,
    model text,
    serial_no text,
    purchase_order_no text,
    asset_status text DEFAULT 'planned'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipment_pkey PRIMARY KEY (id),
    CONSTRAINT equipment_asset_status_check CHECK (
        asset_status = ANY (
            ARRAY[
                'planned'::text,
                'ordered'::text,
                'in_service'::text,
                'spare'::text,
                'removed'::text,
                'scrapped'::text,
                'archived'::text
            ]
        )
    )
);

COMMENT ON TABLE public.equipment IS 'Project-level physical equipment assets that may be installed against stable engineering tags.';

CREATE TABLE IF NOT EXISTS public.tag_equipment_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tag_id uuid NOT NULL,
    equipment_id uuid NOT NULL,
    installed_from date NOT NULL,
    installed_to date,
    is_current boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_equipment_assignment_pkey PRIMARY KEY (id),
    CONSTRAINT tag_equipment_assignment_status_check CHECK (status = ANY (ARRAY['active'::text, 'archived'::text])),
    CONSTRAINT tag_equipment_assignment_dates_check CHECK (installed_to IS NULL OR installed_to >= installed_from)
);

COMMENT ON TABLE public.tag_equipment_assignment IS 'Installation history linking stable tags to physical equipment assets.';

ALTER TABLE ONLY public.class_relationship
    ADD CONSTRAINT class_relationship_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.class_relationship
    ADD CONSTRAINT class_relationship_source_class_id_fkey FOREIGN KEY (source_class_id) REFERENCES public.class(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.class_relationship
    ADD CONSTRAINT class_relationship_target_class_id_fkey FOREIGN KEY (target_class_id) REFERENCES public.class(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_class_fkey FOREIGN KEY (class_id) REFERENCES public.class(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.tag_equipment_assignment
    ADD CONSTRAINT tag_equipment_assignment_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tag(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tag_equipment_assignment
    ADD CONSTRAINT tag_equipment_assignment_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX class_relationship_pair_uidx
    ON public.class_relationship USING btree (standard_id, source_class_id, target_class_id, relationship_type)
    WHERE status <> 'archived'::text;

CREATE INDEX class_relationship_source_idx
    ON public.class_relationship USING btree (standard_id, source_class_id, relationship_type, status);

CREATE INDEX class_relationship_target_idx
    ON public.class_relationship USING btree (standard_id, target_class_id, relationship_type, status);

CREATE UNIQUE INDEX equipment_project_no_uidx
    ON public.equipment USING btree (project_id, lower(equipment_no))
    WHERE asset_status <> 'archived'::text;

CREATE INDEX equipment_project_class_idx
    ON public.equipment USING btree (project_id, class_id, asset_status);

CREATE UNIQUE INDEX tag_equipment_assignment_current_tag_uidx
    ON public.tag_equipment_assignment USING btree (tag_id)
    WHERE is_current AND status <> 'archived'::text;

CREATE UNIQUE INDEX tag_equipment_assignment_current_equipment_uidx
    ON public.tag_equipment_assignment USING btree (equipment_id)
    WHERE is_current AND status <> 'archived'::text;

CREATE INDEX tag_equipment_assignment_history_idx
    ON public.tag_equipment_assignment USING btree (tag_id, installed_from DESC);

DROP TRIGGER IF EXISTS class_relationship_set_updated_at ON public.class_relationship;
CREATE TRIGGER class_relationship_set_updated_at BEFORE UPDATE ON public.class_relationship
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS equipment_set_updated_at ON public.equipment;
CREATE TRIGGER equipment_set_updated_at BEFORE UPDATE ON public.equipment
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS tag_equipment_assignment_set_updated_at ON public.tag_equipment_assignment;
CREATE TRIGGER tag_equipment_assignment_set_updated_at BEFORE UPDATE ON public.tag_equipment_assignment
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
