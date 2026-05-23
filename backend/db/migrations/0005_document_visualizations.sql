CREATE TABLE public.document_visualization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    revision_id uuid NOT NULL,
    source_file_id uuid NOT NULL,
    preview_file_id uuid NOT NULL,
    annotation_manifest_file_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_visualization_pkey PRIMARY KEY (id),
    CONSTRAINT document_visualization_distinct_source_preview_check CHECK (source_file_id <> preview_file_id),
    CONSTRAINT document_visualization_manifest_distinct_check CHECK (
        annotation_manifest_file_id IS NULL
        OR (annotation_manifest_file_id <> source_file_id AND annotation_manifest_file_id <> preview_file_id)
    )
);

COMMENT ON TABLE public.document_visualization IS 'Revision-scoped 3D preview records linking source model files to Spark-readable preview assets.';
COMMENT ON COLUMN public.document_visualization.metadata IS 'Viewer metadata such as units, coordinate system, default camera, and conversion tool details.';

ALTER TABLE ONLY public.document_visualization
    ADD CONSTRAINT document_visualization_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.document_revision(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_visualization
    ADD CONSTRAINT document_visualization_source_file_id_fkey FOREIGN KEY (source_file_id) REFERENCES public.document_file(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.document_visualization
    ADD CONSTRAINT document_visualization_preview_file_id_fkey FOREIGN KEY (preview_file_id) REFERENCES public.document_file(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.document_visualization
    ADD CONSTRAINT document_visualization_annotation_manifest_file_id_fkey FOREIGN KEY (annotation_manifest_file_id) REFERENCES public.document_file(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX document_visualization_revision_preview_uidx
    ON public.document_visualization USING btree (revision_id, preview_file_id);

CREATE INDEX document_visualization_revision_created_at_idx
    ON public.document_visualization USING btree (revision_id, created_at DESC);

DROP TRIGGER IF EXISTS document_visualization_set_updated_at ON public.document_visualization;
CREATE TRIGGER document_visualization_set_updated_at BEFORE UPDATE ON public.document_visualization
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
