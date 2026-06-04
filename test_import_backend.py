"""
Backend unit tests for the Import tab in the Honcho Dashboard plugin.

Tests cover:
  - GET /hermes-sessions — list Hermes sessions available for import
  - POST /import-sessions — import selected sessions into Honcho
  - Integration: dry-run mode, error handling, batch message upload
"""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard.plugin_api import router, get_hermes_db_path

app = FastAPI()
app.include_router(router, prefix="/api/plugins/honcho-dashboard")

client = TestClient(app, raise_server_exceptions=False)

API_PREFIX = "/api/plugins/honcho-dashboard"
WORKSPACE = os.environ.get("HONCHO_WORKSPACE", "hermes-botfred")
TOKEN = "test-token"


def auth_headers():
    return {"X-Hermes-Session-Token": TOKEN, "Authorization": f"Bearer {TOKEN}"}


# ---------------------------------------------------------------------------
# Test helpers — create a temporary Hermes DB with known data
# ---------------------------------------------------------------------------

@pytest.fixture
def hermes_db(tmp_path):
    """Create a temporary Hermes state.db with test sessions and messages."""
    db_path = tmp_path / "state.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, source TEXT, user_id TEXT, model TEXT,
            model_config TEXT, system_prompt TEXT, parent_session_id TEXT,
            started_at REAL, ended_at REAL, end_reason TEXT,
            message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
            input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
            cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
            reasoning_tokens INTEGER DEFAULT 0, billing_provider TEXT,
            billing_base_url TEXT, billing_mode TEXT,
            estimated_cost_usd REAL, actual_cost_usd REAL,
            cost_status TEXT, cost_source TEXT, pricing_version TEXT,
            title TEXT, api_call_count INTEGER DEFAULT 0,
            handoff_state TEXT, handoff_platform TEXT, handoff_error TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
            tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
            timestamp REAL, token_count INTEGER, finish_reason TEXT,
            reasoning TEXT, reasoning_content TEXT, reasoning_details TEXT,
            codex_reasoning_items TEXT, codex_message_items TEXT,
            platform_message_id TEXT, observed INTEGER DEFAULT 0
        )
    """)

    # Session 1: Normal session with user/assistant messages
    conn.execute(
        "INSERT INTO sessions (id, title, source, message_count, started_at) VALUES (?, ?, ?, ?, ?)",
        ("test-session-1", "Test Session One", "telegram", 4, 1780000000.0),
    )
    for i, (role, content) in enumerate([
        ("user", "Hello, this is a test message"),
        ("assistant", "Hi there! How can I help?"),
        ("user", "Tell me about street food"),
        ("assistant", "Street food is amazing..."),
    ]):
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("test-session-1", role, content, 1780000000.0 + i),
        )

    # Session 2: Already imported (has -import suffix in Honcho — simulated)
    conn.execute(
        "INSERT INTO sessions (id, title, source, message_count, started_at) VALUES (?, ?, ?, ?, ?)",
        ("test-session-2", "Already Imported", "telegram", 2, 1780001000.0),
    )
    conn.execute(
        "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
        ("test-session-2", "user", "Old message", 1780001000.0),
    )
    conn.execute(
        "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
        ("test-session-2", "assistant", "Old response", 1780001001.0),
    )

    # Session 3: No user/assistant messages (only tool calls)
    conn.execute(
        "INSERT INTO sessions (id, title, source, message_count, started_at) VALUES (?, ?, ?, ?, ?)",
        ("test-session-3", "Tool Only", "telegram", 5, 1780002000.0),
    )
    conn.execute(
        "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
        ("test-session-3", "tool", "tool result", 1780002000.0),
    )

    # Session 4: Large session (for batching test)
    conn.execute(
        "INSERT INTO sessions (id, title, source, message_count, started_at) VALUES (?, ?, ?, ?, ?)",
        ("test-session-4", "Large Session", "telegram", 120, 1780003000.0),
    )
    for i in range(60):
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("test-session-4", "user", f"User message {i}", 1780003000.0 + i * 2),
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("test-session-4", "assistant", f"Assistant response {i}", 1780003000.0 + i * 2 + 1),
        )

    conn.commit()
    conn.close()

    # Patch get_hermes_db_path to use our test DB
    with patch("dashboard.plugin_api.get_hermes_db_path", return_value=db_path):
        yield db_path


# =================================================================== #
# GET /hermes-sessions
# =================================================================== #

class TestGetHermesSessions:
    """Tests for GET /api/plugins/honcho-dashboard/hermes-sessions"""

    def test_returns_200(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        assert resp.status_code == 200

    def test_returns_sessions_list(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        data = resp.json()
        assert "sessions" in data
        assert "total" in data
        assert "imported_count" in data

    def test_returns_all_sessions(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        data = resp.json()
        assert data["total"] == 4

    def test_session_fields_present(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        data = resp.json()
        s = data["sessions"][0]
        assert "id" in s
        assert "title" in s
        assert "source" in s
        assert "message_count" in s
        assert "started_at" in s
        assert "already_imported" in s
        assert "user_messages" in s
        assert "assistant_messages" in s
        assert "total_importable" in s

    def test_message_counts_accurate(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        data = resp.json()
        s1 = next(s for s in data["sessions"] if s["id"] == "test-session-1")
        assert s1["user_messages"] == 2
        assert s1["assistant_messages"] == 2
        assert s1["total_importable"] == 4

    def test_tool_only_session_has_zero_importable(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        data = resp.json()
        s3 = next(s for s in data["sessions"] if s["id"] == "test-session-3")
        assert s3["user_messages"] == 0
        assert s3["assistant_messages"] == 0
        assert s3["total_importable"] == 0

    def test_large_session_counts(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        data = resp.json()
        s4 = next(s for s in data["sessions"] if s["id"] == "test-session-4")
        assert s4["user_messages"] == 60
        assert s4["assistant_messages"] == 60
        assert s4["total_importable"] == 120

    def test_sessions_ordered_by_date_desc(self, hermes_db):
        resp = client.get(f"{API_PREFIX}/hermes-sessions")
        data = resp.json()
        sessions = data["sessions"]
        dates = [s["started_at"] for s in sessions]
        assert dates == sorted(dates, reverse=True)

    def test_already_imported_detection(self, hermes_db):
        """Sessions with -import suffix in Honcho should be marked as imported."""
        with patch("dashboard.plugin_api._get_imported_sessions", return_value={"test-session-2"}):
            resp = client.get(f"{API_PREFIX}/hermes-sessions")
            data = resp.json()
            s2 = next(s for s in data["sessions"] if s["id"] == "test-session-2")
            assert s2["already_imported"] is True

    def test_not_imported_by_default(self, hermes_db):
        with patch("dashboard.plugin_api._get_imported_sessions", return_value=set()):
            resp = client.get(f"{API_PREFIX}/hermes-sessions")
            data = resp.json()
            for s in data["sessions"]:
                assert s["already_imported"] is False

    def test_missing_db_returns_empty(self, tmp_path):
        """If Hermes DB doesn't exist, return empty list."""
        fake_path = tmp_path / "nonexistent.db"
        with patch("dashboard.plugin_api.get_hermes_db_path", return_value=fake_path):
            resp = client.get(f"{API_PREFIX}/hermes-sessions")
            assert resp.status_code == 200
            data = resp.json()
            assert data["sessions"] == []
            assert data["total"] == 0


# =================================================================== #
# POST /import-sessions
# =================================================================== #

class TestImportSessions:
    """Tests for POST /api/plugins/honcho-dashboard/import-sessions"""

    def test_returns_400_for_empty_session_ids(self, hermes_db):
        resp = client.post(f"{API_PREFIX}/import-sessions",
            json={"session_ids": [], "user_peer_id": "user1", "assistant_peer_id": "asst1"},
            headers=auth_headers())
        assert resp.status_code == 400

    def test_returns_400_for_missing_user_peer(self, hermes_db):
        resp = client.post(f"{API_PREFIX}/import-sessions",
            json={"session_ids": ["test-session-1"], "user_peer_id": "", "assistant_peer_id": "asst1"},
            headers=auth_headers())
        assert resp.status_code == 400

    def test_returns_400_for_missing_assistant_peer(self, hermes_db):
        resp = client.post(f"{API_PREFIX}/import-sessions",
            json={"session_ids": ["test-session-1"], "user_peer_id": "user1", "assistant_peer_id": ""},
            headers=auth_headers())
        assert resp.status_code == 400

    def test_dry_run_returns_message_count(self, hermes_db):
        resp = client.post(f"{API_PREFIX}/import-sessions",
            json={
                "session_ids": ["test-session-1"],
                "user_peer_id": "user1",
                "assistant_peer_id": "asst1",
                "dry_run": True,
            },
            headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["dry_run"] is True
        assert data["results"][0]["status"] == "dry_run"
        assert data["results"][0]["message_count"] == 4
        assert data["results"][0]["user_messages"] == 2
        assert data["results"][0]["assistant_messages"] == 2

    def test_dry_run_does_not_create_session(self, hermes_db):
        """Dry run should not call Honcho API to create sessions."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": True,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            mock_post.assert_not_called()

    def test_import_creates_session_and_messages(self, hermes_db):
        """Real import should create session and add messages via Honcho API."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "Test Session One-import"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["results"][0]["status"] == "imported"
            assert data["results"][0]["messages_imported"] == 4
            # Should have called honcho_post: 1 for session + 1 for messages (4 msgs < 50 batch)
            assert mock_post.call_count == 2

    def test_import_maps_user_role_correctly(self, hermes_db):
        """User messages should be mapped to user_peer_id."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1"],
                    "user_peer_id": "kit-bryan",
                    "assistant_peer_id": "hermes-owl",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            # Check the messages call (second call)
            messages_call = mock_post.call_args_list[1]
            body = messages_call[0][1] if len(messages_call[0]) > 1 else messages_call[1].get("body", {})
            msgs = body.get("messages", [])
            user_msgs = [m for m in msgs if m["peer_id"] == "kit-bryan"]
            asst_msgs = [m for m in msgs if m["peer_id"] == "hermes-owl"]
            assert len(user_msgs) == 2
            assert len(asst_msgs) == 2

    def test_import_batches_large_sessions(self, hermes_db):
        """Sessions with >50 messages should be batched."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-4"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["results"][0]["status"] == "imported"
            assert data["results"][0]["messages_imported"] == 120
            # 1 session create + 3 message batches (50+50+20)
            assert mock_post.call_count == 4

    def test_import_skips_empty_sessions(self, hermes_db):
        """Sessions with no user/assistant messages should be skipped."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-3"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["results"][0]["status"] == "skipped"
            assert "No user/assistant messages" in data["results"][0]["reason"]
            mock_post.assert_not_called()

    def test_import_handles_honcho_error(self, hermes_db):
        """If Honcho API returns an error, session should be marked as error."""
        from fastapi import HTTPException
        with patch("dashboard.plugin_api.honcho_post", side_effect=HTTPException(status_code=500, detail="Honcho down")):
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["results"][0]["status"] == "error"
            assert "Honcho down" in data["results"][0]["reason"]

    def test_import_multiple_sessions(self, hermes_db):
        """Importing multiple sessions should return results for each."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1", "test-session-3"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["results"]) == 2
            assert data["summary"]["total"] == 2
            assert data["summary"]["imported"] == 1
            assert data["summary"]["skipped"] == 1

    def test_import_summary_counts(self, hermes_db):
        """Summary should correctly count imported/error/skipped."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1", "test-session-3", "test-session-4"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            data = resp.json()
            assert data["summary"]["total"] == 3
            assert data["summary"]["imported"] == 2
            assert data["summary"]["skipped"] == 1
            assert data["summary"]["errors"] == 0

    def test_import_uses_id_for_session_name(self, hermes_db):
        """Honcho session name should be '{hermes_session_id}-import' (ID is Honcho-safe)."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            # First call is session creation
            session_call = mock_post.call_args_list[0]
            body = session_call[0][1] if len(session_call[0]) > 1 else session_call[1].get("body", {})
            assert body["id"] == "test-session-1-import"
            # Title should be in metadata
            assert body["metadata"]["hermes_title"] == "Test Session One"

    def test_import_uses_id_when_no_title(self, hermes_db):
        """If session has no title, use session ID for Honcho session name."""
        # Add a session with no title
        conn = sqlite3.connect(str(hermes_db))
        conn.execute(
            "INSERT INTO sessions (id, title, source, message_count, started_at) VALUES (?, ?, ?, ?, ?)",
            ("no-title-session", None, "telegram", 2, 1780004000.0),
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("no-title-session", "user", "hi", 1780004000.0),
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("no-title-session", "assistant", "hello", 1780004001.0),
        )
        conn.commit()
        conn.close()

        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["no-title-session"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            session_call = mock_post.call_args_list[0]
            body = session_call[0][1] if len(session_call[0]) > 1 else session_call[1].get("body", {})
            assert body["id"] == "no-title-session-import"


# =================================================================== #
# Import Integration Tests
# =================================================================== #

class TestImportIntegration:
    """Integration tests combining hermes-sessions and import-sessions."""

    def test_full_import_flow(self, hermes_db):
        """List sessions, then import one — verify it shows as imported."""
        # Step 1: List sessions
        resp1 = client.get(f"{API_PREFIX}/hermes-sessions")
        data1 = resp1.json()
        s1 = next(s for s in data1["sessions"] if s["id"] == "test-session-1")
        assert s1["already_imported"] is False
        assert s1["total_importable"] == 4

        # Step 2: Import
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp2 = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp2.status_code == 200
            assert resp2.json()["results"][0]["status"] == "imported"

    def test_import_preserves_existing_sessions(self, hermes_db):
        """Importing a session that already has -import suffix should still work."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-2"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp.status_code == 200
            # Should still import (backend doesn't block re-import)
            assert resp.json()["results"][0]["status"] == "imported"

    def test_dry_run_then_real_import(self, hermes_db):
        """Dry run should not affect real import."""
        # Dry run first
        resp1 = client.post(f"{API_PREFIX}/import-sessions",
            json={
                "session_ids": ["test-session-1"],
                "user_peer_id": "user1",
                "assistant_peer_id": "asst1",
                "dry_run": True,
            },
            headers=auth_headers())
        assert resp1.json()["dry_run"] is True

        # Real import should still work
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"id": "test"}
            resp2 = client.post(f"{API_PREFIX}/import-sessions",
                json={
                    "session_ids": ["test-session-1"],
                    "user_peer_id": "user1",
                    "assistant_peer_id": "asst1",
                    "dry_run": False,
                },
                headers=auth_headers())
            assert resp2.json()["results"][0]["status"] == "imported"
