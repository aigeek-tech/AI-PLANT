CREATE TABLE public.document_visualization_object (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visualization_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    label text NOT NULL,
    resolver_type text DEFAULT 'anchor'::text NOT NULL,
    coordinate_space text DEFAULT 'splat_local'::text NOT NULL,
    anchor_position double precision[],
    primitive jsonb DEFAULT '{}'::jsonb NOT NULL,
    geometry_asset_id text,
    priority integer DEFAULT 0 NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    selectable boolean DEFAULT true NOT NULL,
    highlightable boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_visualization_object_pkey PRIMARY KEY (id),
    CONSTRAINT document_visualization_object_target_kind_check CHECK (
        target_kind = ANY (ARRAY['tag'::text, 'equipment'::text, 'document'::text, 'pbs_node'::text, 'custom'::text])
    ),
    CONSTRAINT document_visualization_object_target_id_check CHECK (length(TRIM(BOTH FROM target_id)) > 0),
    CONSTRAINT document_visualization_object_label_check CHECK (length(TRIM(BOTH FROM label)) > 0),
    CONSTRAINT document_visualization_object_resolver_type_check CHECK (
        resolver_type = ANY (ARRAY['mesh'::text, 'primitive'::text, 'bbox'::text, 'anchor'::text])
    ),
    CONSTRAINT document_visualization_object_coordinate_space_check CHECK (
        coordinate_space = ANY (ARRAY['splat_local'::text, 'world'::text])
    ),
    CONSTRAINT document_visualization_object_anchor_position_check CHECK (
        anchor_position IS NULL OR array_length(anchor_position, 1) = 3
    ),
    CONSTRAINT document_visualization_object_anchor_resolver_check CHECK (
        resolver_type <> 'anchor'::text OR anchor_position IS NOT NULL
    ),
    CONSTRAINT document_visualization_object_primitive_resolver_check CHECK (
        resolver_type <> ALL (ARRAY['primitive'::text, 'bbox'::text])
        OR primitive <> '{}'::jsonb
    )
);

COMMENT ON TABLE public.document_visualization_object IS 'Semantic interaction objects layered over 3D visualizations for selecting tags, equipment, documents, and PBS nodes.';
COMMENT ON COLUMN public.document_visualization_object.coordinate_space IS 'Coordinate system for anchor_position and primitive geometry. splat_local follows the visualization splat transform.';
COMMENT ON COLUMN public.document_visualization_object.primitive IS 'Simplified pick geometry such as box, sphere, capsule, or cylinder for semantic object resolution.';

ALTER TABLE ONLY public.document_visualization_object
    ADD CONSTRAINT document_visualization_object_visualization_id_fkey FOREIGN KEY (visualization_id) REFERENCES public.document_visualization(id) ON DELETE CASCADE;

CREATE INDEX document_visualization_object_visualization_priority_idx
    ON public.document_visualization_object USING btree (visualization_id, visible, selectable, priority DESC, created_at DESC);

CREATE INDEX document_visualization_object_target_idx
    ON public.document_visualization_object USING btree (target_kind, target_id);

CREATE INDEX document_visualization_object_primitive_gin_idx
    ON public.document_visualization_object USING gin (primitive);

DROP TRIGGER IF EXISTS document_visualization_object_set_updated_at ON public.document_visualization_object;
CREATE TRIGGER document_visualization_object_set_updated_at BEFORE UPDATE ON public.document_visualization_object
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
