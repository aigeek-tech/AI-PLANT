CREATE TABLE public.standard_import_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text NOT NULL,
    file_ext text NOT NULL,
    file_size integer DEFAULT 0 NOT NULL,
    checksum_sha256 text,
    target_mode text DEFAULT 'new'::text NOT NULL,
    target_standard_id uuid,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'validated'::text NOT NULL,
    source_standard_code text,
    committed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT standard_import_job_target_mode_check CHECK (
        target_mode = ANY (ARRAY['new'::text, 'merge'::text])
    ),
    CONSTRAINT standard_import_job_status_check CHECK (
        status = ANY (ARRAY['validated'::text, 'committed'::text])
    )
);

COMMENT ON TABLE public.standard_import_job IS 'Stores AI-assisted standard import draft jobs and validation summary.';

CREATE TABLE public.standard_import_file (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    original_filename text NOT NULL,
    file_ext text NOT NULL,
    mime_type text,
    size_bytes integer DEFAULT 0 NOT NULL,
    checksum_sha256 text,
    parser_profile text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.standard_import_file IS 'Stores source file metadata for a standard import job.';

CREATE TABLE public.standard_import_chunk (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    file_id uuid,
    chunk_no integer NOT NULL,
    source_kind text NOT NULL,
    sheet_name text,
    page_no integer,
    table_index integer,
    heading_path text[] DEFAULT '{}'::text[] NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.standard_import_chunk IS 'Stores extracted text/table chunks used as AI context and evidence.';

CREATE TABLE public.standard_import_row (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    row_number integer NOT NULL,
    source_kind text DEFAULT 'table'::text NOT NULL,
    sheet_name text,
    page_no integer,
    table_index integer,
    source_row_number integer NOT NULL,
    entity_kind text NOT NULL,
    "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
    normalized_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    action text,
    confidence numeric(4,3) DEFAULT 0.650 NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT standard_import_row_action_check CHECK (
        action IS NULL OR action = ANY (ARRAY['create'::text, 'update'::text, 'skip'::text])
    ),
    CONSTRAINT standard_import_row_entity_kind_check CHECK (
        entity_kind = ANY (
            ARRAY[
                'standard'::text,
                'pbs_level'::text,
                'tag_class'::text,
                'tag_attribute'::text,
                'document_type'::text,
                'document_attribute'::text
            ]
        )
    ),
    CONSTRAINT standard_import_row_source_kind_check CHECK (
        source_kind = ANY (ARRAY['table'::text, 'text'::text, 'template'::text, 'manual'::text])
    ),
    CONSTRAINT standard_import_row_status_check CHECK (
        status = ANY (ARRAY['ready'::text, 'error'::text, 'warning'::text, 'conflict'::text])
    )
);

COMMENT ON TABLE public.standard_import_row IS 'Stores candidate standard-library items generated from source tables, validation issues, and evidence.';

ALTER TABLE ONLY public.standard_import_job
    ADD CONSTRAINT standard_import_job_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.standard_import_file
    ADD CONSTRAINT standard_import_file_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.standard_import_chunk
    ADD CONSTRAINT standard_import_chunk_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.standard_import_row
    ADD CONSTRAINT standard_import_row_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.standard_import_row
    ADD CONSTRAINT standard_import_row_job_id_row_number_key UNIQUE (job_id, row_number);

CREATE INDEX standard_import_job_created_idx ON public.standard_import_job USING btree (created_at DESC);
CREATE INDEX standard_import_job_target_standard_idx ON public.standard_import_job USING btree (target_standard_id);
CREATE INDEX standard_import_file_job_idx ON public.standard_import_file USING btree (job_id);
CREATE INDEX standard_import_chunk_job_idx ON public.standard_import_chunk USING btree (job_id, chunk_no);
CREATE INDEX standard_import_row_job_status_idx ON public.standard_import_row USING btree (job_id, status, row_number);
CREATE INDEX standard_import_row_source_idx ON public.standard_import_row USING btree (job_id, sheet_name, page_no, table_index);

CREATE TRIGGER standard_import_job_set_updated_at BEFORE UPDATE ON public.standard_import_job FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER standard_import_row_set_updated_at BEFORE UPDATE ON public.standard_import_row FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE ONLY public.standard_import_job
    ADD CONSTRAINT standard_import_job_target_standard_id_fkey FOREIGN KEY (target_standard_id) REFERENCES public.standard(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.standard_import_file
    ADD CONSTRAINT standard_import_file_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.standard_import_job(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.standard_import_chunk
    ADD CONSTRAINT standard_import_chunk_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.standard_import_file(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.standard_import_chunk
    ADD CONSTRAINT standard_import_chunk_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.standard_import_job(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.standard_import_row
    ADD CONSTRAINT standard_import_row_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.standard_import_job(id) ON DELETE CASCADE;
