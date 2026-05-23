CREATE TABLE public.agent_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by text NOT NULL,
    title text DEFAULT '新会话'::text NOT NULL,
    context_scope text DEFAULT 'none'::text NOT NULL,
    context_ref jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_session_context_scope_check CHECK (
        context_scope = ANY (
            ARRAY[
                'none'::text,
                'current_page'::text,
                'project'::text,
                'database'::text,
                'workspace'::text
            ]
        )
    ),
    CONSTRAINT agent_session_status_check CHECK (status = ANY (ARRAY['active'::text, 'archived'::text])),
    CONSTRAINT agent_session_title_check CHECK (length(TRIM(BOTH FROM title)) > 0)
);

COMMENT ON TABLE public.agent_session IS 'Global AI Harness conversations independent from project-scoped draft jobs.';
COMMENT ON COLUMN public.agent_session.context_scope IS 'Optional user-selected context; project context is no longer mandatory.';

CREATE TABLE public.agent_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    created_by text NOT NULL,
    prompt text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    runner text DEFAULT 'claw-cli'::text NOT NULL,
    capability_profile text DEFAULT 'full_access'::text NOT NULL,
    context_scope text DEFAULT 'none'::text NOT NULL,
    context_ref jsonb DEFAULT '{}'::jsonb NOT NULL,
    session_dir text,
    result jsonb,
    error text,
    cancel_requested boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_run_capability_profile_check CHECK (capability_profile = ANY (ARRAY['full_access'::text])),
    CONSTRAINT agent_run_context_scope_check CHECK (
        context_scope = ANY (
            ARRAY[
                'none'::text,
                'current_page'::text,
                'project'::text,
                'database'::text,
                'workspace'::text
            ]
        )
    ),
    CONSTRAINT agent_run_prompt_check CHECK (length(TRIM(BOTH FROM prompt)) > 0),
    CONSTRAINT agent_run_runner_check CHECK (length(TRIM(BOTH FROM runner)) > 0),
    CONSTRAINT agent_run_status_check CHECK (
        status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])
    )
);

COMMENT ON TABLE public.agent_run IS 'A single executable AI Harness turn with replayable events and audit state.';
COMMENT ON COLUMN public.agent_run.capability_profile IS 'Execution capability profile. The first platform version exposes full_access.';

CREATE TABLE public.agent_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    run_id uuid,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    structured_content jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_message_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]))
);

COMMENT ON TABLE public.agent_message IS 'Persisted chat messages displayed by the global AI Harness assistant.';

CREATE TABLE public.agent_run_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    seq integer NOT NULL,
    event_type text NOT NULL,
    message text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_run_event_event_type_check CHECK (length(TRIM(BOTH FROM event_type)) > 0),
    CONSTRAINT agent_run_event_seq_check CHECK (seq > 0)
);

COMMENT ON TABLE public.agent_run_event IS 'Append-only event log used by AI Harness SSE replay and audit views.';

ALTER TABLE ONLY public.agent_session
    ADD CONSTRAINT agent_session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_run
    ADD CONSTRAINT agent_run_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_message
    ADD CONSTRAINT agent_message_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_run_event
    ADD CONSTRAINT agent_run_event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_run_event
    ADD CONSTRAINT agent_run_event_seq_key UNIQUE (run_id, seq);

ALTER TABLE ONLY public.agent_run
    ADD CONSTRAINT agent_run_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_session(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_message
    ADD CONSTRAINT agent_message_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_session(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_message
    ADD CONSTRAINT agent_message_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_run(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_run_event
    ADD CONSTRAINT agent_run_event_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_run(id) ON DELETE CASCADE;

CREATE INDEX agent_session_created_by_updated_at_idx
    ON public.agent_session USING btree (created_by, updated_at DESC);

CREATE INDEX agent_message_session_id_created_at_idx
    ON public.agent_message USING btree (session_id, created_at ASC);

CREATE INDEX agent_message_run_id_idx
    ON public.agent_message USING btree (run_id);

CREATE INDEX agent_run_session_status_created_at_idx
    ON public.agent_run USING btree (session_id, status, created_at DESC);

CREATE INDEX agent_run_created_by_status_created_at_idx
    ON public.agent_run USING btree (created_by, status, created_at DESC);

CREATE INDEX agent_run_event_run_id_seq_idx
    ON public.agent_run_event USING btree (run_id, seq);

ALTER TABLE public.agent_artifact
    ADD COLUMN run_id uuid;

ALTER TABLE public.agent_artifact
    ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE ONLY public.agent_artifact
    ADD CONSTRAINT agent_artifact_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_run(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_artifact
    ADD CONSTRAINT agent_artifact_owner_check CHECK (job_id IS NOT NULL OR run_id IS NOT NULL);

CREATE INDEX agent_artifact_run_id_created_at_idx
    ON public.agent_artifact USING btree (run_id, created_at DESC);

CREATE TRIGGER agent_session_set_updated_at BEFORE UPDATE ON public.agent_session
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER agent_run_set_updated_at BEFORE UPDATE ON public.agent_run
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
