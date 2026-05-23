-- Plugin platform runtime: uploaded packages, installation state, capabilities, migrations, and audit.

CREATE TABLE IF NOT EXISTS public.plugin_package (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plugin_id text NOT NULL,
    version text NOT NULL,
    filename text NOT NULL,
    checksum text NOT NULL,
    storage_path text NOT NULL,
    manifest jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_package_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_package_plugin_id_check CHECK (plugin_id ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
    CONSTRAINT plugin_package_version_check CHECK (length(TRIM(BOTH FROM version)) > 0),
    CONSTRAINT plugin_package_filename_check CHECK (length(TRIM(BOTH FROM filename)) > 0),
    CONSTRAINT plugin_package_checksum_check CHECK (length(TRIM(BOTH FROM checksum)) > 0),
    CONSTRAINT plugin_package_status_check CHECK (status = ANY (ARRAY['uploaded'::text, 'rejected'::text]))
);

CREATE TABLE IF NOT EXISTS public.plugin_installation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plugin_id text NOT NULL,
    package_id uuid,
    version text NOT NULL,
    status text DEFAULT 'disabled'::text NOT NULL,
    manifest jsonb DEFAULT '{}'::jsonb NOT NULL,
    installed_path text NOT NULL,
    installed_at timestamp with time zone DEFAULT now() NOT NULL,
    enabled_at timestamp with time zone,
    disabled_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_installation_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_installation_plugin_id_uidx UNIQUE (plugin_id),
    CONSTRAINT plugin_installation_status_check CHECK (status = ANY (ARRAY['disabled'::text, 'enabled'::text, 'failed'::text, 'uninstalled'::text, 'purged'::text]))
);

CREATE TABLE IF NOT EXISTS public.plugin_migration_journal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plugin_id text NOT NULL,
    plugin_version text NOT NULL,
    migration_path text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_migration_journal_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_migration_journal_uidx UNIQUE (plugin_id, plugin_version, migration_path)
);

CREATE TABLE IF NOT EXISTS public.plugin_capability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plugin_id text NOT NULL,
    capability_type text NOT NULL,
    capability_key text NOT NULL,
    definition jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_capability_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_capability_uidx UNIQUE (plugin_id, capability_type, capability_key)
);

CREATE TABLE IF NOT EXISTS public.plugin_install_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plugin_id text NOT NULL,
    action text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_install_job_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_install_job_action_check CHECK (length(TRIM(BOTH FROM action)) > 0),
    CONSTRAINT plugin_install_job_status_check CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text]))
);

CREATE TABLE IF NOT EXISTS public.plugin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plugin_id text NOT NULL,
    action text NOT NULL,
    actor_user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_audit_log_action_check CHECK (length(TRIM(BOTH FROM action)) > 0)
);

ALTER TABLE ONLY public.plugin_installation
    DROP CONSTRAINT IF EXISTS plugin_installation_package_id_fkey;
ALTER TABLE ONLY public.plugin_installation
    ADD CONSTRAINT plugin_installation_package_id_fkey
    FOREIGN KEY (package_id) REFERENCES public.plugin_package(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.plugin_audit_log
    DROP CONSTRAINT IF EXISTS plugin_audit_log_actor_user_id_fkey;
ALTER TABLE ONLY public.plugin_audit_log
    ADD CONSTRAINT plugin_audit_log_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.user_account(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS plugin_package_checksum_uidx
    ON public.plugin_package USING btree (checksum);

CREATE UNIQUE INDEX IF NOT EXISTS plugin_package_plugin_version_uidx
    ON public.plugin_package USING btree (plugin_id, version)
    WHERE status = 'uploaded';

CREATE INDEX IF NOT EXISTS plugin_package_plugin_version_idx
    ON public.plugin_package USING btree (plugin_id, version, created_at DESC);

CREATE INDEX IF NOT EXISTS plugin_capability_plugin_type_idx
    ON public.plugin_capability USING btree (plugin_id, capability_type);

CREATE INDEX IF NOT EXISTS plugin_audit_log_plugin_idx
    ON public.plugin_audit_log USING btree (plugin_id, created_at DESC);

DROP TRIGGER IF EXISTS plugin_installation_set_updated_at ON public.plugin_installation;
CREATE TRIGGER plugin_installation_set_updated_at BEFORE UPDATE ON public.plugin_installation
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS plugin_install_job_set_updated_at ON public.plugin_install_job;
CREATE TRIGGER plugin_install_job_set_updated_at BEFORE UPDATE ON public.plugin_install_job
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.permission_definition (code, scope_kind, resource, action, description)
VALUES ('system.plugin.manage', 'system', 'system.plugin', 'manage', 'Install, enable, disable, and purge Smart Design plugins.')
ON CONFLICT (code) DO UPDATE
SET scope_kind = EXCLUDED.scope_kind,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description;

INSERT INTO public.role_permission (role_id, permission_code)
SELECT rd.id, 'system.plugin.manage'
FROM public.role_definition rd
WHERE rd.code = 'system_admin'
ON CONFLICT DO NOTHING;
