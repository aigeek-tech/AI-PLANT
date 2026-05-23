--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Debian 16.13-1.pgdg13+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attribute_definition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attribute_definition (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    value_type text NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    unit_family text,
    enum_options jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    standard_id uuid,
    group_name text,
    applies_to text DEFAULT 'tag'::text NOT NULL,
    CONSTRAINT attribute_definition_applies_to_check CHECK ((applies_to = ANY (ARRAY['tag'::text, 'document'::text, 'both'::text]))),
    CONSTRAINT attribute_definition_owner_check CHECK ((((class_id IS NOT NULL) AND (standard_id IS NULL)) OR ((class_id IS NULL) AND (standard_id IS NOT NULL)))),
    CONSTRAINT attribute_definition_sort_order_check CHECK ((sort_order >= 0)),
    CONSTRAINT attribute_definition_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'deprecated'::text, 'archived'::text]))),
    CONSTRAINT attribute_definition_value_type_check CHECK ((value_type = ANY (ARRAY['string'::text, 'number'::text, 'integer'::text, 'boolean'::text, 'date'::text, 'enum'::text, 'json'::text])))
);


--
-- Name: TABLE attribute_definition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.attribute_definition IS 'Attributes owned by a specific standard class.';


--
-- Name: COLUMN attribute_definition.applies_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.attribute_definition.applies_to IS 'Whether the standard-level attribute applies to tags, documents, or both.';


--
-- Name: authorization_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authorization_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    scope_kind text,
    scope_id uuid,
    target_type text,
    target_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT authorization_audit_log_action_check CHECK ((length(TRIM(BOTH FROM action)) > 0)),
    CONSTRAINT authorization_audit_log_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['system'::text, 'standard'::text, 'project'::text])))
);


--
-- Name: TABLE authorization_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.authorization_audit_log IS 'Security audit log for identity and authorization changes.';


--
-- Name: class; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    standard_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    level_no integer DEFAULT 1 NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    applies_to text DEFAULT 'tag'::text NOT NULL,
    CONSTRAINT class_applies_to_check CHECK ((applies_to = ANY (ARRAY['tag'::text, 'document'::text, 'both'::text]))),
    CONSTRAINT class_level_no_check CHECK ((level_no > 0)),
    CONSTRAINT class_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'deprecated'::text, 'archived'::text])))
);


--
-- Name: TABLE class; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.class IS 'Class definitions belonging to a specific standard.';


--
-- Name: COLUMN class.applies_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.class.applies_to IS 'Whether the standard class is intended for tag, document, or both domains.';


--
-- Name: document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    document_no text NOT NULL,
    title text NOT NULL,
    discipline text,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    current_revision_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    class_id uuid,
    CONSTRAINT document_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: TABLE document; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document IS 'Project-level logical documents identified by document number.';


--
-- Name: document_file; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_file (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    revision_id uuid NOT NULL,
    file_role text NOT NULL,
    original_filename text NOT NULL,
    relative_path text,
    storage_provider text NOT NULL,
    bucket text NOT NULL,
    object_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text,
    etag text,
    preview_mode text NOT NULL,
    status text DEFAULT 'pending_upload'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_file_file_role_check CHECK ((file_role = ANY (ARRAY['primary'::text, 'source'::text, 'attachment'::text, 'reference'::text]))),
    CONSTRAINT document_file_preview_mode_check CHECK ((preview_mode = ANY (ARRAY['inline'::text, 'download'::text]))),
    CONSTRAINT document_file_size_bytes_check CHECK ((size_bytes >= 0)),
    CONSTRAINT document_file_status_check CHECK ((status = ANY (ARRAY['pending_upload'::text, 'ready'::text, 'upload_failed'::text, 'deleted'::text]))),
    CONSTRAINT document_file_storage_provider_check CHECK ((storage_provider = 's3'::text))
);


--
-- Name: TABLE document_file; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_file IS 'Stored files that belong to a specific document revision.';


--
-- Name: document_pbs_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_pbs_link (
    document_id uuid NOT NULL,
    pbs_node_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE document_pbs_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_pbs_link IS 'Optional PBS associations for project documents.';


--
-- Name: document_revision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_revision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    revision_no text NOT NULL,
    state text DEFAULT 'draft'::text NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    issued_at timestamp with time zone,
    change_summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_revision_state_check CHECK ((state = ANY (ARRAY['draft'::text, 'issued'::text, 'void'::text])))
);


--
-- Name: TABLE document_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_revision IS 'Revision history for a project document.';


--
-- Name: document_tag_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_tag_link (
    document_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE document_tag_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_tag_link IS 'Optional TAG associations for project documents.';


--
-- Name: pbs_level_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pbs_level_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    standard_id uuid NOT NULL,
    level_no integer NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pbs_level_template_level_no_check CHECK ((level_no > 0))
);


--
-- Name: TABLE pbs_level_template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pbs_level_template IS 'Defines ordered PBS hierarchy levels for a standard (e.g. Unit > System > Subsystem).';


--
-- Name: pbs_node; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pbs_node (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    parent_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    node_type text DEFAULT 'folder'::text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    level_template_id uuid
);


--
-- Name: permission_definition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_definition (
    code text NOT NULL,
    scope_kind text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permission_definition_action_check CHECK ((length(TRIM(BOTH FROM action)) > 0)),
    CONSTRAINT permission_definition_code_check CHECK ((length(TRIM(BOTH FROM code)) > 0)),
    CONSTRAINT permission_definition_resource_check CHECK ((length(TRIM(BOTH FROM resource)) > 0)),
    CONSTRAINT permission_definition_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['system'::text, 'standard'::text, 'project'::text])))
);


--
-- Name: TABLE permission_definition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permission_definition IS 'Canonical permission catalog used by backend dependencies and frontend gates.';


--
-- Name: project; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    overview text,
    reference_attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    thumbnail_url text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: TABLE project; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.project IS 'Stores project configurations including definitions, properties, and status.';


--
-- Name: project_relation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_relation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    relation_type_id uuid NOT NULL,
    source_kind text NOT NULL,
    source_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    note text,
    source_system text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_relation_check CHECK ((NOT ((source_kind = target_kind) AND (source_id = target_id)))),
    CONSTRAINT project_relation_source_kind_check CHECK ((source_kind = ANY (ARRAY['document'::text, 'tag'::text, 'pbs_node'::text]))),
    CONSTRAINT project_relation_target_kind_check CHECK ((target_kind = ANY (ARRAY['document'::text, 'tag'::text, 'pbs_node'::text])))
);


--
-- Name: TABLE project_relation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.project_relation IS 'Project-level relation instances between documents, tags, and PBS nodes.';


--
-- Name: relation_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relation_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    source_kind text NOT NULL,
    target_kind text NOT NULL,
    is_symmetric boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT relation_type_source_kind_check CHECK ((source_kind = ANY (ARRAY['document'::text, 'tag'::text, 'pbs_node'::text]))),
    CONSTRAINT relation_type_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text]))),
    CONSTRAINT relation_type_target_kind_check CHECK ((target_kind = ANY (ARRAY['document'::text, 'tag'::text, 'pbs_node'::text])))
);


--
-- Name: TABLE relation_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.relation_type IS 'Project-scoped relation type catalog for horizontal links between business entities.';


--
-- Name: role_definition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_definition (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    scope_kind text NOT NULL,
    is_builtin boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_definition_code_check CHECK ((length(TRIM(BOTH FROM code)) > 0)),
    CONSTRAINT role_definition_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT role_definition_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['system'::text, 'standard'::text, 'project'::text]))),
    CONSTRAINT role_definition_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: TABLE role_definition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_definition IS 'Reusable role templates scoped globally, per standard, or per project.';


--
-- Name: role_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permission (
    role_id uuid NOT NULL,
    permission_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_permission IS 'Permission grants attached to role templates.';


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT settings_value_check CHECK ((jsonb_typeof(value) = 'object'::text))
);


--
-- Name: TABLE settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.settings IS 'Generic application settings stored as key/json pairs.';


--
-- Name: COLUMN settings.key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.key IS 'Stable setting identifier such as ai.';


--
-- Name: COLUMN settings.value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.value IS 'Setting payload stored as a JSON object.';


--
-- Name: standard; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standard (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    version_label text,
    thumbnail_url text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT standard_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: TABLE standard; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.standard IS 'Top-level engineering standard families.';


--
-- Name: tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tag_no text NOT NULL,
    name text NOT NULL,
    class_id uuid,
    attribute_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pbs_node_id uuid,
    parent_tag_id uuid
);


--
-- Name: TABLE tag; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tag IS 'Engineering objects or tags belonging to a project, arranged in a PBS structure.';


--
-- Name: tag_import_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_import_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    filename text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'validated'::text NOT NULL,
    committed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tag_import_job; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tag_import_job IS 'Stores project-level TAG import draft jobs and their validation summary.';


--
-- Name: tag_import_row; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_import_row (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    row_number integer NOT NULL,
    "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
    normalized_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    existing_tag_id uuid,
    conflict_action text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tag_import_row; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tag_import_row IS 'Stores row-by-row TAG import draft data, validation issues, and conflict decisions.';


--
-- Name: user_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    email text,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_login_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_account_display_name_check CHECK ((length(TRIM(BOTH FROM display_name)) > 0)),
    CONSTRAINT user_account_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT user_account_username_check CHECK ((length(TRIM(BOTH FROM username)) > 0))
);


--
-- Name: TABLE user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_account IS 'Application users for Smart Design authentication.';


--
-- Name: user_import_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_import_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'validated'::text NOT NULL,
    committed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_import_job; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_import_job IS 'Stores user import draft jobs and validation summaries.';


--
-- Name: user_import_row; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_import_row (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    row_number integer NOT NULL,
    "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
    normalized_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    action text NOT NULL,
    existing_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_import_row; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_import_row IS 'Stores row-by-row user import draft data, normalized values, and validation issues.';


--
-- Name: user_role_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_role_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    scope_id uuid,
    granted_by uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_role_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_role_assignment IS 'Role assignments for users, optionally scoped to one project or standard.';


--
-- Name: user_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    user_agent text,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_session IS 'Opaque browser sessions stored as token hashes; raw tokens are never persisted.';


--
-- Name: attribute_definition attribute_definition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attribute_definition
    ADD CONSTRAINT attribute_definition_pkey PRIMARY KEY (id);


--
-- Name: authorization_audit_log authorization_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorization_audit_log
    ADD CONSTRAINT authorization_audit_log_pkey PRIMARY KEY (id);


--
-- Name: class class_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_pkey PRIMARY KEY (id);


--
-- Name: document_file document_file_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_file
    ADD CONSTRAINT document_file_pkey PRIMARY KEY (id);


--
-- Name: document_pbs_link document_pbs_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_pbs_link
    ADD CONSTRAINT document_pbs_link_pkey PRIMARY KEY (document_id, pbs_node_id);


--
-- Name: document document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_pkey PRIMARY KEY (id);


--
-- Name: document document_project_id_document_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_project_id_document_no_key UNIQUE (project_id, document_no);


--
-- Name: document_revision document_revision_document_id_revision_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_revision
    ADD CONSTRAINT document_revision_document_id_revision_no_key UNIQUE (document_id, revision_no);


--
-- Name: document_revision document_revision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_revision
    ADD CONSTRAINT document_revision_pkey PRIMARY KEY (id);


--
-- Name: document_tag_link document_tag_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_tag_link
    ADD CONSTRAINT document_tag_link_pkey PRIMARY KEY (document_id, tag_id);


--
-- Name: pbs_level_template pbs_level_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_level_template
    ADD CONSTRAINT pbs_level_template_pkey PRIMARY KEY (id);


--
-- Name: pbs_level_template pbs_level_template_standard_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_level_template
    ADD CONSTRAINT pbs_level_template_standard_id_code_key UNIQUE (standard_id, code);


--
-- Name: pbs_level_template pbs_level_template_standard_id_level_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_level_template
    ADD CONSTRAINT pbs_level_template_standard_id_level_no_key UNIQUE (standard_id, level_no);


--
-- Name: pbs_node pbs_node_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_node
    ADD CONSTRAINT pbs_node_pkey PRIMARY KEY (id);


--
-- Name: pbs_node pbs_node_project_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_node
    ADD CONSTRAINT pbs_node_project_id_code_key UNIQUE (project_id, code);


--
-- Name: permission_definition permission_definition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_definition
    ADD CONSTRAINT permission_definition_pkey PRIMARY KEY (code);


--
-- Name: project project_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_code_key UNIQUE (code);


--
-- Name: project project_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);


--
-- Name: project_relation project_relation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relation
    ADD CONSTRAINT project_relation_pkey PRIMARY KEY (id);


--
-- Name: relation_type relation_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relation_type
    ADD CONSTRAINT relation_type_pkey PRIMARY KEY (id);


--
-- Name: role_definition role_definition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_definition
    ADD CONSTRAINT role_definition_pkey PRIMARY KEY (id);


--
-- Name: role_permission role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_pkey PRIMARY KEY (role_id, permission_code);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: standard standard_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standard
    ADD CONSTRAINT standard_code_key UNIQUE (code);


--
-- Name: standard standard_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standard
    ADD CONSTRAINT standard_pkey PRIMARY KEY (id);


--
-- Name: tag_import_job tag_import_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_import_job
    ADD CONSTRAINT tag_import_job_pkey PRIMARY KEY (id);


--
-- Name: tag_import_row tag_import_row_job_id_row_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_import_row
    ADD CONSTRAINT tag_import_row_job_id_row_number_key UNIQUE (job_id, row_number);


--
-- Name: tag_import_row tag_import_row_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_import_row
    ADD CONSTRAINT tag_import_row_pkey PRIMARY KEY (id);


--
-- Name: tag tag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (id);


--
-- Name: tag tag_project_id_tag_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_project_id_tag_no_key UNIQUE (project_id, tag_no);


--
-- Name: user_account user_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (id);


--
-- Name: user_import_job user_import_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_import_job
    ADD CONSTRAINT user_import_job_pkey PRIMARY KEY (id);


--
-- Name: user_import_row user_import_row_job_id_row_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_import_row
    ADD CONSTRAINT user_import_row_job_id_row_number_key UNIQUE (job_id, row_number);


--
-- Name: user_import_row user_import_row_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_import_row
    ADD CONSTRAINT user_import_row_pkey PRIMARY KEY (id);


--
-- Name: user_role_assignment user_role_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignment
    ADD CONSTRAINT user_role_assignment_pkey PRIMARY KEY (id);


--
-- Name: user_session user_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT user_session_pkey PRIMARY KEY (id);


--
-- Name: attribute_definition_class_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attribute_definition_class_code_uidx ON public.attribute_definition USING btree (class_id, lower(code)) WHERE ((class_id IS NOT NULL) AND (status <> 'archived'::text));


--
-- Name: attribute_definition_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribute_definition_class_idx ON public.attribute_definition USING btree (class_id);


--
-- Name: attribute_definition_class_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribute_definition_class_sort_idx ON public.attribute_definition USING btree (class_id, sort_order, code);


--
-- Name: attribute_definition_enum_options_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribute_definition_enum_options_gin ON public.attribute_definition USING gin (enum_options jsonb_path_ops);


--
-- Name: attribute_definition_standard_code_applies_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attribute_definition_standard_code_applies_uidx ON public.attribute_definition USING btree (standard_id, lower(code), applies_to) WHERE ((standard_id IS NOT NULL) AND (status <> 'archived'::text));


--
-- Name: authorization_audit_log_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX authorization_audit_log_actor_idx ON public.authorization_audit_log USING btree (actor_user_id, created_at DESC);


--
-- Name: authorization_audit_log_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX authorization_audit_log_scope_idx ON public.authorization_audit_log USING btree (scope_kind, scope_id, created_at DESC);


--
-- Name: class_standard_code_applies_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX class_standard_code_applies_uidx ON public.class USING btree (standard_id, lower(code), applies_to) WHERE (status <> 'archived'::text);


--
-- Name: class_standard_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_standard_parent_idx ON public.class USING btree (standard_id, parent_id);


--
-- Name: document_file_object_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_file_object_uidx ON public.document_file USING btree (bucket, object_key);


--
-- Name: document_file_primary_ready_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_file_primary_ready_uidx ON public.document_file USING btree (revision_id) WHERE ((file_role = 'primary'::text) AND (status = 'ready'::text));


--
-- Name: document_file_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_file_revision_idx ON public.document_file USING btree (revision_id, created_at DESC);


--
-- Name: document_pbs_link_pbs_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_pbs_link_pbs_idx ON public.document_pbs_link USING btree (pbs_node_id, document_id);


--
-- Name: document_project_discipline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_project_discipline_idx ON public.document USING btree (project_id, discipline);


--
-- Name: document_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_project_idx ON public.document USING btree (project_id, created_at DESC);


--
-- Name: document_revision_current_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_revision_current_uidx ON public.document_revision USING btree (document_id) WHERE is_current;


--
-- Name: document_revision_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_revision_document_idx ON public.document_revision USING btree (document_id, created_at DESC);


--
-- Name: document_tag_link_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_tag_link_tag_idx ON public.document_tag_link USING btree (tag_id, document_id);


--
-- Name: pbs_level_template_standard_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pbs_level_template_standard_idx ON public.pbs_level_template USING btree (standard_id, level_no);


--
-- Name: project_relation_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_relation_source_idx ON public.project_relation USING btree (project_id, source_kind, source_id, relation_type_id);


--
-- Name: project_relation_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_relation_target_idx ON public.project_relation USING btree (project_id, target_kind, target_id, relation_type_id);


--
-- Name: project_relation_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_relation_type_idx ON public.project_relation USING btree (project_id, relation_type_id, created_at DESC);


--
-- Name: project_relation_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_relation_unique_idx ON public.project_relation USING btree (project_id, relation_type_id, source_kind, source_id, target_kind, target_id);


--
-- Name: relation_type_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX relation_type_code_uidx ON public.relation_type USING btree (lower(code));


--
-- Name: relation_type_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX relation_type_kind_idx ON public.relation_type USING btree (source_kind, target_kind, status);


--
-- Name: role_definition_scope_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX role_definition_scope_code_uidx ON public.role_definition USING btree (scope_kind, code);


--
-- Name: role_definition_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_definition_status_idx ON public.role_definition USING btree (scope_kind, status);


--
-- Name: role_permission_permission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_permission_permission_idx ON public.role_permission USING btree (permission_code, role_id);


--
-- Name: tag_attribute_values_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_attribute_values_gin_idx ON public.tag USING gin (attribute_values jsonb_path_ops);


--
-- Name: tag_import_job_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_import_job_project_idx ON public.tag_import_job USING btree (project_id, created_at DESC);


--
-- Name: tag_import_row_existing_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_import_row_existing_tag_idx ON public.tag_import_row USING btree (existing_tag_id);


--
-- Name: tag_import_row_job_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_import_row_job_status_idx ON public.tag_import_row USING btree (job_id, status, row_number);


--
-- Name: tag_parent_tag_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_parent_tag_id_idx ON public.tag USING btree (parent_tag_id);


--
-- Name: tag_project_pbs_parent_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_project_pbs_parent_created_idx ON public.tag USING btree (project_id, pbs_node_id, parent_tag_id, created_at DESC);


--
-- Name: user_account_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_account_email_uidx ON public.user_account USING btree (lower(email)) WHERE (email IS NOT NULL);


--
-- Name: user_account_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_account_status_idx ON public.user_account USING btree (status, created_at DESC);


--
-- Name: user_account_username_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_account_username_uidx ON public.user_account USING btree (lower(username));


--
-- Name: user_import_job_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_import_job_created_idx ON public.user_import_job USING btree (created_at DESC);


--
-- Name: user_import_row_existing_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_import_row_existing_user_idx ON public.user_import_row USING btree (existing_user_id);


--
-- Name: user_import_row_job_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_import_row_job_status_idx ON public.user_import_row USING btree (job_id, status, row_number);


--
-- Name: user_role_assignment_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_role_assignment_scope_idx ON public.user_role_assignment USING btree (scope_id, role_id);


--
-- Name: user_role_assignment_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_role_assignment_unique_idx ON public.user_role_assignment USING btree (user_id, role_id, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: user_role_assignment_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_role_assignment_user_idx ON public.user_role_assignment USING btree (user_id, scope_id);


--
-- Name: user_session_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_session_active_idx ON public.user_session USING btree (expires_at) WHERE (revoked_at IS NULL);


--
-- Name: user_session_token_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_session_token_hash_uidx ON public.user_session USING btree (session_token_hash);


--
-- Name: user_session_user_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_session_user_expires_idx ON public.user_session USING btree (user_id, expires_at DESC);


--
-- Name: attribute_definition attribute_definition_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER attribute_definition_set_updated_at BEFORE UPDATE ON public.attribute_definition FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: class class_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER class_set_updated_at BEFORE UPDATE ON public.class FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: document_file document_file_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_file_set_updated_at BEFORE UPDATE ON public.document_file FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: document_revision document_revision_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_revision_set_updated_at BEFORE UPDATE ON public.document_revision FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: document document_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_set_updated_at BEFORE UPDATE ON public.document FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pbs_level_template pbs_level_template_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pbs_level_template_set_updated_at BEFORE UPDATE ON public.pbs_level_template FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: project_relation project_relation_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_relation_set_updated_at BEFORE UPDATE ON public.project_relation FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: project project_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_set_updated_at BEFORE UPDATE ON public.project FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: relation_type relation_type_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER relation_type_set_updated_at BEFORE UPDATE ON public.relation_type FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: role_definition role_definition_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER role_definition_set_updated_at BEFORE UPDATE ON public.role_definition FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: settings settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: standard standard_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER standard_set_updated_at BEFORE UPDATE ON public.standard FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tag_import_job tag_import_job_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_import_job_set_updated_at BEFORE UPDATE ON public.tag_import_job FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tag_import_row tag_import_row_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_import_row_set_updated_at BEFORE UPDATE ON public.tag_import_row FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tag tag_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_set_updated_at BEFORE UPDATE ON public.tag FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_account user_account_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_account_set_updated_at BEFORE UPDATE ON public.user_account FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_import_job user_import_job_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_import_job_set_updated_at BEFORE UPDATE ON public.user_import_job FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_import_row user_import_row_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_import_row_set_updated_at BEFORE UPDATE ON public.user_import_row FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_session user_session_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_session_set_updated_at BEFORE UPDATE ON public.user_session FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: attribute_definition attribute_definition_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attribute_definition
    ADD CONSTRAINT attribute_definition_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id) ON DELETE CASCADE;


--
-- Name: attribute_definition attribute_definition_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attribute_definition
    ADD CONSTRAINT attribute_definition_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.standard(id) ON DELETE CASCADE;


--
-- Name: authorization_audit_log authorization_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorization_audit_log
    ADD CONSTRAINT authorization_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.user_account(id) ON DELETE SET NULL;


--
-- Name: class class_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.class(id) ON DELETE SET NULL;


--
-- Name: class class_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.standard(id) ON DELETE CASCADE;


--
-- Name: document document_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id) ON DELETE RESTRICT;


--
-- Name: document document_current_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_current_revision_fk FOREIGN KEY (current_revision_id) REFERENCES public.document_revision(id) ON DELETE SET NULL;


--
-- Name: document_file document_file_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_file
    ADD CONSTRAINT document_file_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.document_revision(id) ON DELETE CASCADE;


--
-- Name: document_pbs_link document_pbs_link_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_pbs_link
    ADD CONSTRAINT document_pbs_link_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;


--
-- Name: document_pbs_link document_pbs_link_pbs_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_pbs_link
    ADD CONSTRAINT document_pbs_link_pbs_node_id_fkey FOREIGN KEY (pbs_node_id) REFERENCES public.pbs_node(id) ON DELETE CASCADE;


--
-- Name: document document_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document
    ADD CONSTRAINT document_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE;


--
-- Name: document_revision document_revision_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_revision
    ADD CONSTRAINT document_revision_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;


--
-- Name: document_tag_link document_tag_link_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_tag_link
    ADD CONSTRAINT document_tag_link_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document(id) ON DELETE CASCADE;


--
-- Name: document_tag_link document_tag_link_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_tag_link
    ADD CONSTRAINT document_tag_link_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tag(id) ON DELETE CASCADE;


--
-- Name: pbs_level_template pbs_level_template_standard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_level_template
    ADD CONSTRAINT pbs_level_template_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.standard(id) ON DELETE CASCADE;


--
-- Name: pbs_node pbs_node_level_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_node
    ADD CONSTRAINT pbs_node_level_template_id_fkey FOREIGN KEY (level_template_id) REFERENCES public.pbs_level_template(id);


--
-- Name: pbs_node pbs_node_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_node
    ADD CONSTRAINT pbs_node_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.pbs_node(id) ON DELETE CASCADE;


--
-- Name: pbs_node pbs_node_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pbs_node
    ADD CONSTRAINT pbs_node_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE;


--
-- Name: project_relation project_relation_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relation
    ADD CONSTRAINT project_relation_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE;


--
-- Name: project_relation project_relation_relation_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relation
    ADD CONSTRAINT project_relation_relation_type_id_fkey FOREIGN KEY (relation_type_id) REFERENCES public.relation_type(id) ON DELETE RESTRICT;


--
-- Name: role_permission role_permission_permission_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_permission_code_fkey FOREIGN KEY (permission_code) REFERENCES public.permission_definition(code) ON DELETE CASCADE;


--
-- Name: role_permission role_permission_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.role_definition(id) ON DELETE CASCADE;


--
-- Name: tag tag_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id) ON DELETE RESTRICT;


--
-- Name: tag_import_job tag_import_job_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_import_job
    ADD CONSTRAINT tag_import_job_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE;


--
-- Name: tag_import_row tag_import_row_existing_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_import_row
    ADD CONSTRAINT tag_import_row_existing_tag_id_fkey FOREIGN KEY (existing_tag_id) REFERENCES public.tag(id) ON DELETE SET NULL;


--
-- Name: tag_import_row tag_import_row_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_import_row
    ADD CONSTRAINT tag_import_row_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.tag_import_job(id) ON DELETE CASCADE;


--
-- Name: tag tag_parent_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_parent_tag_id_fkey FOREIGN KEY (parent_tag_id) REFERENCES public.tag(id) ON DELETE CASCADE;


--
-- Name: tag tag_pbs_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_pbs_node_id_fkey FOREIGN KEY (pbs_node_id) REFERENCES public.pbs_node(id) ON DELETE CASCADE;


--
-- Name: tag tag_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.project(id) ON DELETE CASCADE;


--
-- Name: user_import_row user_import_row_existing_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_import_row
    ADD CONSTRAINT user_import_row_existing_user_id_fkey FOREIGN KEY (existing_user_id) REFERENCES public.user_account(id) ON DELETE SET NULL;


--
-- Name: user_import_row user_import_row_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_import_row
    ADD CONSTRAINT user_import_row_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.user_import_job(id) ON DELETE CASCADE;


--
-- Name: user_role_assignment user_role_assignment_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignment
    ADD CONSTRAINT user_role_assignment_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.user_account(id) ON DELETE SET NULL;


--
-- Name: user_role_assignment user_role_assignment_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignment
    ADD CONSTRAINT user_role_assignment_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.role_definition(id) ON DELETE CASCADE;


--
-- Name: user_role_assignment user_role_assignment_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignment
    ADD CONSTRAINT user_role_assignment_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(id) ON DELETE CASCADE;


--
-- Name: user_session user_session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT user_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



--
-- System catalog seed data required by the application
--

INSERT INTO public.permission_definition (code, scope_kind, resource, action, description)
VALUES
    ('system.user.manage', 'system', 'system.user', 'manage', 'Manage users.'),
    ('system.role.manage', 'system', 'system.role', 'manage', 'Manage roles and permissions.'),
    ('system.audit.read', 'system', 'system.audit', 'read', 'Read authorization audit logs.'),
    ('system.settings.ai.read', 'system', 'system.settings.ai', 'read', 'Read AI endpoint settings.'),
    ('system.settings.ai.write', 'system', 'system.settings.ai', 'write', 'Update and test AI endpoint settings.'),
    ('system.settings.branding.read', 'system', 'system.settings.branding', 'read', 'Read system branding settings.'),
    ('system.settings.branding.write', 'system', 'system.settings.branding', 'write', 'Update system branding settings.'),
    ('project.create', 'system', 'project', 'create', 'Create projects.'),
    ('standard.read', 'standard', 'standard', 'read', 'Read standard library data.'),
    ('standard.write', 'standard', 'standard', 'write', 'Modify standard library data.'),
    ('project.read', 'project', 'project', 'read', 'Read project metadata.'),
    ('project.update', 'project', 'project', 'update', 'Update project metadata.'),
    ('project.delete', 'project', 'project', 'delete', 'Delete projects and their scoped data.'),
    ('project.member.manage', 'project', 'project.member', 'manage', 'Manage project members.'),
    ('project.pbs.read', 'project', 'project.pbs', 'read', 'Read project PBS nodes.'),
    ('project.pbs.write', 'project', 'project.pbs', 'write', 'Modify project PBS nodes.'),
    ('project.tag.read', 'project', 'project.tag', 'read', 'Read project TAG data.'),
    ('project.tag.write', 'project', 'project.tag', 'write', 'Modify project TAG data.'),
    ('project.tag.import', 'project', 'project.tag', 'import', 'Import project TAG data.'),
    ('project.document.read', 'project', 'project.document', 'read', 'Read project document data.'),
    ('project.document.write', 'project', 'project.document', 'write', 'Modify project document data.'),
    ('project.document.upload', 'project', 'project.document', 'upload', 'Upload project document files.'),
    ('project.relation.read', 'project', 'project.relation', 'read', 'Read project relations.'),
    ('project.relation.write', 'project', 'project.relation', 'write', 'Modify project relations.')
ON CONFLICT (code) DO UPDATE
SET
    scope_kind = EXCLUDED.scope_kind,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description;

INSERT INTO public.role_definition (code, name, scope_kind, is_builtin, status)
VALUES
    ('system_admin', 'System Administrator', 'system', true, 'active'),
    ('standard_admin', 'Standard Administrator', 'system', true, 'active'),
    ('project_creator', 'Project Creator', 'system', true, 'active'),
    ('project_owner', 'Project Owner', 'project', true, 'active'),
    ('project_editor', 'Project Editor', 'project', true, 'active'),
    ('project_viewer', 'Project Viewer', 'project', true, 'active')
ON CONFLICT (scope_kind, code) DO UPDATE
SET
    name = EXCLUDED.name,
    is_builtin = EXCLUDED.is_builtin,
    status = EXCLUDED.status;

INSERT INTO public.role_permission (role_id, permission_code)
SELECT rd.id, pd.code
FROM public.role_definition rd
CROSS JOIN public.permission_definition pd
WHERE rd.code = 'system_admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permission (role_id, permission_code)
SELECT rd.id, permission_code
FROM public.role_definition rd
CROSS JOIN (
    VALUES
        ('standard.read'),
        ('standard.write')
) AS permissions(permission_code)
WHERE rd.code = 'standard_admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permission (role_id, permission_code)
SELECT rd.id, 'project.create'
FROM public.role_definition rd
WHERE rd.code = 'project_creator'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permission (role_id, permission_code)
SELECT rd.id, permission_code
FROM public.role_definition rd
CROSS JOIN (
    VALUES
        ('project.read'),
        ('project.update'),
        ('project.delete'),
        ('project.member.manage'),
        ('project.pbs.read'),
        ('project.pbs.write'),
        ('project.tag.read'),
        ('project.tag.write'),
        ('project.tag.import'),
        ('project.document.read'),
        ('project.document.write'),
        ('project.document.upload'),
        ('project.relation.read'),
        ('project.relation.write'),
        ('standard.read')
) AS permissions(permission_code)
WHERE rd.code = 'project_owner'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permission (role_id, permission_code)
SELECT rd.id, permission_code
FROM public.role_definition rd
CROSS JOIN (
    VALUES
        ('project.read'),
        ('project.update'),
        ('project.pbs.read'),
        ('project.pbs.write'),
        ('project.tag.read'),
        ('project.tag.write'),
        ('project.tag.import'),
        ('project.document.read'),
        ('project.document.write'),
        ('project.document.upload'),
        ('project.relation.read'),
        ('project.relation.write'),
        ('standard.read')
) AS permissions(permission_code)
WHERE rd.code = 'project_editor'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permission (role_id, permission_code)
SELECT rd.id, permission_code
FROM public.role_definition rd
CROSS JOIN (
    VALUES
        ('project.read'),
        ('project.pbs.read'),
        ('project.tag.read'),
        ('project.document.read'),
        ('project.relation.read'),
        ('standard.read')
) AS permissions(permission_code)
WHERE rd.code = 'project_viewer'
ON CONFLICT DO NOTHING;

INSERT INTO public.relation_type (code, name, source_kind, target_kind, is_symmetric, status, metadata)
VALUES
    ('document_links_tag', 'Document Links Tag', 'document', 'tag', false, 'active', '{}'::jsonb),
    ('document_links_pbs', 'Document Links PBS', 'document', 'pbs_node', false, 'active', '{}'::jsonb),
    ('tag_relates_tag', 'Tag Relates Tag', 'tag', 'tag', true, 'active', '{}'::jsonb)
ON CONFLICT (lower(code)) DO NOTHING;
