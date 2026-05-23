ALTER TABLE public.document_visualization
    DROP CONSTRAINT IF EXISTS document_visualization_distinct_source_preview_check;

CREATE TABLE public.document_conversion_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    document_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    source_file_id uuid NOT NULL,
    output_file_id uuid,
    status text DEFAULT 'queued'::text NOT NULL,
    input_format text NOT NULL,
    output_format text DEFAULT 'rad'::text NOT NULL,
    error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_conversion_job_pkey PRIMARY KEY (id),
    CONSTRAINT document_conversion_job_attempts_check CHECK (attempts >= 0),
    CONSTRAINT document_conversion_job_input_format_check CHECK (length(TRIM(BOTH FROM input_format)) > 0),
    CONSTRAINT document_conversion_job_output_format_check CHECK (length(TRIM(BOTH FROM output_format)) > 0),
    CONSTRAINT document_conversion_job_status_check CHECK (
        status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])
    )
);

COMMENT ON TABLE public.document_conversion_job IS 'Asynchronous document model conversion jobs that generate viewer assets such as Spark RAD files.';
COMMENT ON COLUMN public.document_conversion_job.metadata IS 'Conversion metadata including command names, generated filenames, byte sizes, and diagnostics.';

ALTER TABLE ONLY public.document_conversion_job
    ADD CONSTRAINT document_conversion_job_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_conversion_job
    ADD CONSTRAINT document_conversion_job_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_conversion_job
    ADD CONSTRAINT document_conversion_job_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.document_revision(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_conversion_job
    ADD CONSTRAINT document_conversion_job_source_file_id_fkey FOREIGN KEY (source_file_id) REFERENCES public.document_file(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_conversion_job
    ADD CONSTRAINT document_conversion_job_output_file_id_fkey FOREIGN KEY (output_file_id) REFERENCES public.document_file(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX document_conversion_job_source_active_uidx
    ON public.document_conversion_job USING btree (source_file_id)
    WHERE status IN ('queued'::text, 'running'::text);

CREATE INDEX document_conversion_job_revision_status_created_at_idx
    ON public.document_conversion_job USING btree (revision_id, status, created_at DESC);

CREATE INDEX document_conversion_job_status_created_at_idx
    ON public.document_conversion_job USING btree (status, created_at ASC);

DROP TRIGGER IF EXISTS document_conversion_job_set_updated_at ON public.document_conversion_job;
CREATE TRIGGER document_conversion_job_set_updated_at BEFORE UPDATE ON public.document_conversion_job
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
