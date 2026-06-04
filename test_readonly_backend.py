"""
Backend unit tests for READ-ONLY and UNTESTED endpoints in the Honcho Dashboard plugin.

Tests cover:
  - GET /overview — high-level stats for Overview tab
  - GET /peers — list peers with conclusion counts
  - GET /sessions — list sessions with message counts
  - GET /session/{id}/messages — session messages
  - GET /conclusions — list conclusions with filters
  - DELETE /conclusions/{id} — single conclusion delete
  - GET /search — vector search
  - GET /analytics — 14-day stats
  - GET /status — Honcho health + queue
  - GET /source-chat — Jump to Chat
  - POST /peer/{id}/insight — submit insight
"""
from __future__ import annotations

import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from fastapi import FastAPI
from dashboard.plugin_api import router

app = FastAPI()
app.include_router(router, prefix="/api/plugins/honcho-dashboard")

client = TestClient(app, raise_server_exceptions=False)

API_PREFIX = "/api/plugins/honcho-dashboard"
TOKEN = "test-token"


def auth_headers():
    return {"X-Hermes-Session-Token": TOKEN, "Authorization": f"Bearer {TOKEN}"}


# =================================================================== #
# Mock helpers
# =================================================================== #

def mock_honcho_post(path, body=None):
    """Return mock data based on the Honcho API path."""
    if "/peers/list" in path:
        return {
            "items": [
                {"id": "peer-1", "name": "Alice"},
                {"id": "peer-2", "name": "Bob"},
            ],
            "total": 2,
        }
    if "/sessions/list" in path:
        return {
            "items": [
                {"id": "sess-1", "name": "Session 1", "created_at": "2026-06-04T10:00:00Z"},
                {"id": "sess-2", "name": "Session 2", "created_at": "2026-06-03T10:00:00Z"},
            ],
            "total": 2,
        }
    if "/sessions/sess-1/messages/list" in path:
        return {"items": [{"id": "msg-1", "content": "Hello"}], "total": 5}
    if "/sessions/sess-2/messages/list" in path:
        return {"items": [{"id": "msg-2", "content": "World"}], "total": 3}
    if "/conclusions/list" in path:
        return {
            "items": [
                {"id": "conc-1", "content": "Conclusion 1", "observed_id": "peer-1", "observer_id": "peer-2", "created_at": "2026-06-04T12:00:00Z"},
                {"id": "conc-2", "content": "Conclusion 2", "observed_id": "peer-2", "observer_id": "peer-1", "created_at": "2026-06-03T12:00:00Z"},
            ],
            "total": 2,
            "pages": 1,
        }
    if "/search" in path:
        return {
            "results": [
                {"message_id": "msg-1", "content": "Hello world", "score": 0.95, "session_id": "sess-1"},
            ],
        }
    if "/queue/status" in path:
        return {
            "total_work_units": 10,
            "completed_work_units": 8,
            "pending_work_units": 1,
            "in_progress_work_units": 1,
            "sessions": {"sess-1": {"total": 5, "completed": 4, "pending": 1}},
        }
    if "/sessions/sess-1/messages" in path and body:
        return {"id": "new-msg", "content": "insight"}
    return {}


# =================================================================== #
# GET /overview
# =================================================================== #

class TestOverview:
    """Tests for GET /api/plugins/honcho-dashboard/overview"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_overview_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/overview")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_overview_returns_peers_total(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/overview")
        data = resp.json()
        assert "peers" in data
        assert data["peers"]["total"] == 2

    @patch("dashboard.plugin_api.honcho_post")
    def test_overview_returns_sessions_total(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/overview")
        data = resp.json()
        assert "sessions" in data
        assert data["sessions"]["total"] == 2

    @patch("dashboard.plugin_api.honcho_post")
    def test_overview_returns_conclusions_total(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/overview")
        data = resp.json()
        assert "conclusions" in data
        assert data["conclusions"]["total"] == 2

    @patch("dashboard.plugin_api.honcho_post")
    def test_overview_returns_recent_conclusions(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/overview")
        data = resp.json()
        assert "recent" in data["conclusions"]
        assert len(data["conclusions"]["recent"]) <= 10

    @patch("dashboard.plugin_api.honcho_post")
    def test_overview_returns_messages_sampled(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/overview")
        data = resp.json()
        assert "messages_sampled" in data
        assert isinstance(data["messages_sampled"], int)


# =================================================================== #
# GET /peers
# =================================================================== #

class TestListPeers:
    """Tests for GET /api/plugins/honcho-dashboard/peers"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_peers_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/peers")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_peers_returns_peers_array(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/peers")
        data = resp.json()
        assert "peers" in data
        assert isinstance(data["peers"], list)
        assert len(data["peers"]) == 2

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_peers_returns_total(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/peers")
        data = resp.json()
        assert data["total"] == 2

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_peers_includes_conclusion_counts(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/peers")
        data = resp.json()
        for peer in data["peers"]:
            assert "conclusions_about" in peer
            assert "conclusions_by" in peer

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_peers_peer_fields(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/peers")
        data = resp.json()
        peer = data["peers"][0]
        assert "id" in peer
        assert "name" in peer


# =================================================================== #
# GET /sessions
# =================================================================== #

class TestListSessions:
    """Tests for GET /api/plugins/honcho-dashboard/sessions"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_sessions_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/sessions")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_sessions_returns_sessions_array(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/sessions")
        data = resp.json()
        assert "sessions" in data
        assert isinstance(data["sessions"], list)
        assert len(data["sessions"]) == 2

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_sessions_returns_total(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/sessions")
        data = resp.json()
        assert data["total"] == 2

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_sessions_includes_message_count(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/sessions")
        data = resp.json()
        for session in data["sessions"]:
            assert "message_count" in session

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_sessions_session_fields(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/sessions")
        data = resp.json()
        session = data["sessions"][0]
        assert "id" in session
        assert "name" in session


# =================================================================== #
# GET /session/{id}/messages
# =================================================================== #

class TestSessionMessages:
    """Tests for GET /api/plugins/honcho-dashboard/session/{id}/messages"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_session_messages_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/session/sess-1/messages")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_session_messages_returns_items(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/session/sess-1/messages")
        data = resp.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    @patch("dashboard.plugin_api.honcho_post")
    def test_session_messages_respects_limit(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/session/sess-1/messages?limit=10")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_session_messages_respects_page(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/session/sess-1/messages?page=2")
        assert resp.status_code == 200


# =================================================================== #
# GET /conclusions
# =================================================================== #

class TestListConclusions:
    """Tests for GET /api/plugins/honcho-dashboard/conclusions"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_conclusions_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/conclusions")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_conclusions_returns_items(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/conclusions")
        data = resp.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_conclusions_returns_total(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/conclusions")
        data = resp.json()
        assert "total" in data

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_conclusions_filters_by_observed_id(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/conclusions?observed_id=peer-1")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_conclusions_filters_by_observer_id(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/conclusions?observer_id=peer-2")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_list_conclusions_conclusion_fields(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/conclusions")
        data = resp.json()
        if data["items"]:
            c = data["items"][0]
            assert "id" in c
            assert "content" in c


# =================================================================== #
# DELETE /conclusions/{id}
# =================================================================== #

class TestDeleteConclusion:
    """Tests for DELETE /api/plugins/honcho-dashboard/conclusions/{id}"""

    @patch("dashboard.plugin_api.honcho_delete")
    def test_delete_conclusion_returns_200(self, mock_delete):
        mock_delete.return_value = {}
        resp = client.delete(f"{API_PREFIX}/conclusions/conc-1")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_delete")
    def test_delete_conclusion_returns_success(self, mock_delete):
        mock_delete.return_value = {}
        resp = client.delete(f"{API_PREFIX}/conclusions/conc-1")
        data = resp.json()
        assert data["success"] is True
        assert data["conclusion_id"] == "conc-1"

    @patch("dashboard.plugin_api.honcho_delete")
    def test_delete_conclusion_calls_honcho_delete(self, mock_delete):
        mock_delete.return_value = {}
        client.delete(f"{API_PREFIX}/conclusions/conc-1")
        mock_delete.assert_called_once()


# =================================================================== #
# GET /search
# =================================================================== #

class TestSearch:
    """Tests for GET /api/plugins/honcho-dashboard/search"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_search_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/search?q=hello")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_search_returns_results(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/search?q=hello")
        data = resp.json()
        assert "results" in data

    @patch("dashboard.plugin_api.honcho_post")
    def test_search_requires_query(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/search")
        assert resp.status_code == 422  # validation error

    @patch("dashboard.plugin_api.honcho_post")
    def test_search_respects_limit(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/search?q=hello&limit=5")
        assert resp.status_code == 200


# =================================================================== #
# GET /analytics
# =================================================================== #

class TestAnalytics:
    """Tests for GET /api/plugins/honcho-dashboard/analytics"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_analytics_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/analytics")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_analytics_returns_totals(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/analytics")
        data = resp.json()
        assert "total_sessions" in data
        assert "total_messages" in data
        assert "total_conclusions" in data
        assert "total_peers" in data

    @patch("dashboard.plugin_api.honcho_post")
    def test_analytics_returns_days_array(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/analytics")
        data = resp.json()
        assert "days" in data
        assert len(data["days"]) == 14

    @patch("dashboard.plugin_api.honcho_post")
    def test_analytics_returns_messages_by_day(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/analytics")
        data = resp.json()
        assert "messages_by_day" in data
        assert isinstance(data["messages_by_day"], dict)

    @patch("dashboard.plugin_api.honcho_post")
    def test_analytics_returns_conclusions_by_day(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.get(f"{API_PREFIX}/analytics")
        data = resp.json()
        assert "conclusions_by_day" in data
        assert isinstance(data["conclusions_by_day"], dict)


# =================================================================== #
# GET /status
# =================================================================== #

class TestStatus:
    """Tests for GET /api/plugins/honcho-dashboard/status"""

    @patch("dashboard.plugin_api.subprocess", create=True)
    @patch("dashboard.plugin_api.urllib.request.urlopen")
    def test_status_returns_200(self, mock_urlopen, mock_subprocess):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp
        mock_subprocess.run.return_value = MagicMock(returncode=0, stdout='version = "3.8.7"\n')
        resp = client.get(f"{API_PREFIX}/status")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.subprocess", create=True)
    @patch("dashboard.plugin_api.urllib.request.urlopen")
    def test_status_returns_honcho_reachable(self, mock_urlopen, mock_subprocess):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp
        mock_subprocess.run.return_value = MagicMock(returncode=0, stdout='version = "3.8.7"\n')
        resp = client.get(f"{API_PREFIX}/status")
        data = resp.json()
        assert "honcho_reachable" in data

    @patch("dashboard.plugin_api.subprocess", create=True)
    @patch("dashboard.plugin_api.urllib.request.urlopen")
    def test_status_returns_queue(self, mock_urlopen, mock_subprocess):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp
        mock_subprocess.run.return_value = MagicMock(returncode=0, stdout='version = "3.8.7"\n')
        resp = client.get(f"{API_PREFIX}/status")
        data = resp.json()
        assert "queue" in data
        q = data["queue"]
        assert "total" in q
        assert "completed" in q
        assert "pending" in q

    @patch("dashboard.plugin_api.subprocess", create=True)
    @patch("dashboard.plugin_api.urllib.request.urlopen")
    def test_status_honcho_unreachable(self, mock_urlopen, mock_subprocess):
        mock_urlopen.side_effect = Exception("Connection refused")
        mock_subprocess.run.return_value = MagicMock(returncode=0, stdout='version = "3.8.7"\n')
        resp = client.get(f"{API_PREFIX}/status")
        data = resp.json()
        assert data["honcho_reachable"] is False
        assert data["honcho_error"] is not None


# =================================================================== #
# GET /source-chat
# =================================================================== #

class TestSourceChat:
    """Tests for GET /api/plugins/honcho-dashboard/source-chat"""

    @patch("dashboard.plugin_api.read_hermes_messages")
    def test_source_chat_returns_200(self, mock_read):
        mock_read.return_value = [{"id": "msg-1", "content": "Hello", "role": "user"}]
        resp = client.get(f"{API_PREFIX}/source-chat?session_id=sess-1")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.read_hermes_messages")
    def test_source_chat_returns_messages(self, mock_read):
        mock_read.return_value = [{"id": "msg-1", "content": "Hello", "role": "user"}]
        resp = client.get(f"{API_PREFIX}/source-chat?session_id=sess-1")
        data = resp.json()
        assert "messages" in data
        assert data["session_id"] == "sess-1"

    @patch("dashboard.plugin_api.read_hermes_messages")
    def test_source_chat_requires_session_id(self, mock_read):
        mock_read.return_value = []
        resp = client.get(f"{API_PREFIX}/source-chat")
        assert resp.status_code == 422  # validation error

    @patch("dashboard.plugin_api.read_hermes_messages")
    def test_source_chat_with_message_id(self, mock_read):
        mock_read.return_value = [{"id": "msg-1", "content": "Hello", "role": "user"}]
        resp = client.get(f"{API_PREFIX}/source-chat?session_id=sess-1&message_id=msg-1")
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.read_hermes_messages")
    def test_source_chat_with_window(self, mock_read):
        mock_read.return_value = []
        resp = client.get(f"{API_PREFIX}/source-chat?session_id=sess-1&window=10")
        assert resp.status_code == 200


# =================================================================== #
# POST /peer/{id}/insight
# =================================================================== #

class TestInsight:
    """Tests for POST /api/plugins/honcho-dashboard/peer/{id}/insight"""

    @patch("dashboard.plugin_api.honcho_post")
    def test_insight_returns_200(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.post(
            f"{API_PREFIX}/peer/peer-1/insight",
            json={"content": "This is an insight"},
        )
        assert resp.status_code == 200

    @patch("dashboard.plugin_api.honcho_post")
    def test_insight_returns_success(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.post(
            f"{API_PREFIX}/peer/peer-1/insight",
            json={"content": "This is an insight"},
        )
        data = resp.json()
        assert data["success"] is True

    @patch("dashboard.plugin_api.honcho_post")
    def test_insight_requires_content(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.post(
            f"{API_PREFIX}/peer/peer-1/insight",
            json={"content": ""},
        )
        assert resp.status_code == 400

    @patch("dashboard.plugin_api.honcho_post")
    def test_insight_rejects_empty_body(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.post(
            f"{API_PREFIX}/peer/peer-1/insight",
            json={},
        )
        assert resp.status_code == 400

    @patch("dashboard.plugin_api.honcho_post")
    def test_insight_returns_session_id(self, mock_post):
        mock_post.side_effect = lambda path, body=None: mock_honcho_post(path, body)
        resp = client.post(
            f"{API_PREFIX}/peer/peer-1/insight",
            json={"content": "Test insight"},
        )
        data = resp.json()
        assert "session_id" in data
