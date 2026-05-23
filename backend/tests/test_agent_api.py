import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class AgentApiTest(unittest.TestCase):
    def test_creates_harness_session_without_project(self):
        session = {
            "id": "session-1",
            "created_by": "test-admin",
            "title": "新会话",
            "context_scope": "none",
            "context_ref": {},
            "status": "active",
            "created_at": "2026-04-26T00:00:00Z",
            "updated_at": "2026-04-26T00:00:00Z",
        }

        with patch("app.agent_api.create_harness_session_for_user", return_value=session) as create_session:
            response = client.post("/api/agent/sessions", json={})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": session})
        self.assertEqual(create_session.call_args.args[0].context_scope, "none")

    def test_lists_harness_backends(self):
        backends = [
            {
                "id": "claw-cli",
                "label": "Claw CLI",
                "kind": "claw",
                "status": "available",
                "execution_model": "one_shot_cli",
                "is_default": True,
                "capabilities": ["chat"],
                "health_message": None,
                "command_path": "claw",
            }
        ]

        with patch("app.agent_api.list_harness_backends_for_user", return_value=backends):
            response = client.get("/api/agent/backends")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": backends})

    def test_sends_harness_message_and_creates_run(self):
        result = {
            "session": {"id": "session-1", "created_by": "test-admin"},
            "user_message": {"id": "message-user", "role": "user", "content": "你好"},
            "assistant_message": {"id": "message-assistant", "role": "assistant", "content": "正在处理..."},
            "run": {
                "id": "run-1",
                "session_id": "session-1",
                "prompt": "你好",
                "status": "queued",
                "capability_profile": "full_access",
                "context_scope": "none",
                "context_ref": {},
            },
        }

        with patch("app.agent_api.create_harness_message_for_session", return_value=result) as create_message:
            response = client.post(
                "/api/agent/sessions/session-1/messages",
                json={"prompt": "  你好  "},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": result})
        self.assertEqual(create_message.call_args.args[0], "session-1")
        self.assertEqual(create_message.call_args.args[1].prompt, "你好")
        self.assertEqual(create_message.call_args.args[1].capability_profile, "full_access")

    def test_rejects_blank_harness_prompt(self):
        response = client.post(
            "/api/agent/sessions/session-1/messages",
            json={"prompt": "   "},
        )

        self.assertEqual(response.status_code, 422)

    def test_streams_harness_run_events_as_sse(self):
        def event_stream(*_args, **_kwargs):
            yield 'event: agent-event\ndata: {"seq": 1, "event_type": "started"}\n\n'

        with (
            patch("app.agent_api.get_harness_run_for_user", return_value={"id": "run-1", "created_by": "test-admin"}),
            patch("app.agent_api.stream_agent_run_events", side_effect=event_stream),
        ):
            with client.stream("GET", "/api/agent/runs/run-1/events") as response:
                body = response.read().decode("utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: agent-event", body)

    def test_cancels_harness_run(self):
        run = {
            "id": "run-1",
            "session_id": "session-1",
            "created_by": "test-admin",
            "status": "running",
            "cancel_requested": True,
        }

        with patch("app.agent_api.cancel_harness_run_for_user", return_value=run):
            response = client.post("/api/agent/runs/run-1/cancel")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": run})

    def test_creates_project_agent_job(self):
        job = {
            "id": "job-1",
            "project_id": "project-1",
            "created_by": "test-admin",
            "task_type": "project_qa",
            "prompt": "检查项目数据",
            "status": "queued",
            "runner": "claw-cli",
            "session_dir": None,
            "result": None,
            "error": None,
            "cancel_requested": False,
            "created_at": "2026-04-25T00:00:00Z",
            "started_at": None,
            "finished_at": None,
        }

        with patch("app.agent_api.create_agent_job_for_project", return_value=job) as create_job:
            response = client.post(
                "/api/projects/project-1/agent-jobs",
                json={"task_type": "project_qa", "prompt": "检查项目数据"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": job})
        self.assertEqual(create_job.call_args.args[0], "project-1")
        self.assertEqual(create_job.call_args.args[1].prompt, "检查项目数据")

    def test_rejects_blank_project_agent_prompt(self):
        response = client.post(
            "/api/projects/project-1/agent-jobs",
            json={"task_type": "project_qa", "prompt": "   "},
        )

        self.assertEqual(response.status_code, 422)

    def test_returns_404_for_missing_project_agent_job(self):
        with patch("app.agent_api.get_agent_job", return_value=None):
            response = client.get("/api/projects/project-1/agent-jobs/missing")

        self.assertEqual(response.status_code, 404)

    def test_cancels_project_agent_job(self):
        job = {
            "id": "job-1",
            "project_id": "project-1",
            "created_by": "test-admin",
            "task_type": "project_qa",
            "prompt": "检查项目数据",
            "status": "running",
            "runner": "claw-cli",
            "session_dir": "agent-job-job-1",
            "result": None,
            "error": None,
            "cancel_requested": True,
            "created_at": "2026-04-25T00:00:00Z",
            "started_at": "2026-04-25T00:00:01Z",
            "finished_at": None,
        }

        with patch("app.agent_api.cancel_agent_job_for_project", return_value=job):
            response = client.post("/api/projects/project-1/agent-jobs/job-1/cancel")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": job})

    def test_streams_project_agent_job_events_as_sse(self):
        def event_stream(*_args, **_kwargs):
            yield 'event: agent-event\ndata: {"seq": 1, "event_type": "started"}\n\n'

        with (
            patch("app.agent_api.get_agent_job", return_value={"id": "job-1", "project_id": "project-1"}),
            patch("app.agent_api.stream_agent_job_events", side_effect=event_stream),
        ):
            with client.stream("GET", "/api/projects/project-1/agent-jobs/job-1/events") as response:
                body = response.read().decode("utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: agent-event", body)


if __name__ == "__main__":
    unittest.main()
