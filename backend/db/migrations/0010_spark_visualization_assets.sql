CREATE TABLE public.document_visualization_asset (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visualization_id uuid NOT NULL,
    asset_role text NOT NULL,
    filename text NOT NULL,
    storage_provider text DEFAULT 's3'::text NOT NULL,
    bucket text NOT NULL,
    object_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_visualization_asset_pkey PRIMARY KEY (id),
    CONSTRAINT document_visualization_asset_asset_role_check CHECK (
        asset_role = ANY (ARRAY['header'::text, 'chunk'::text, 'source'::text])
    ),
    CONSTRAINT document_visualization_asset_filename_check CHECK (length(TRIM(BOTH FROM filename)) > 0),
    CONSTRAINT document_visualization_asset_size_bytes_check CHECK (size_bytes >= 0),
    CONSTRAINT document_visualization_asset_storage_provider_check CHECK (storage_provider = 's3'::text)
);

COMMENT ON TABLE public.document_visualization_asset IS 'Spark viewer assets for a visualization, including RAD headers and RADC chunks.';

ALTER TABLE ONLY public.document_visualization_asset
    ADD CONSTRAINT document_visualization_asset_visualization_id_fkey FOREIGN KEY (visualization_id) REFERENCES public.document_visualization(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX document_visualization_asset_visualization_filename_uidx
    ON public.document_visualization_asset USING btree (visualization_id, filename);

CREATE UNIQUE INDEX document_visualization_asset_object_uidx
    ON public.document_visualization_asset USING btree (bucket, object_key);

CREATE INDEX document_visualization_asset_visualization_role_idx
    ON public.document_visualization_asset USING btree (visualization_id, asset_role);

DROP TRIGGER IF EXISTS document_visualization_asset_set_updated_at ON public.document_visualization_asset;
CREATE TRIGGER document_visualization_asset_set_updated_at BEFORE UPDATE ON public.document_visualization_asset
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
