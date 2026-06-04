"""
Backend unit tests for the Delete All endpoints in the Honcho Dashboard plugin.

Tests cover:
  - DELETE /peers/all — delete all peers with confirmation
  - DELETE /sessions/all — delete all sessions with confirmation
  - DELETE /conclusions/all — delete all conclusions with confirmation
"""
from __future__ import annotations

import json
import os
import pytest
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard.plugin_api import router

app = FastAPI()
app.include_router(router, prefix="/api/plugins/honcho-dashboard")

client = TestClient(app, raise_server_exceptions=False)

API_PREFIX = "/api/plugins/honcho-dashboard"
TOKEN = "test-token"


def auth_headers():
    return {"X-Hermes-Session-Token": TOKEN, "Authorization": f"Bearer {TOKEN}"}


# =================================================================== #
# DELETE /peers/all
# =================================================================== #

class TestDeleteAllPeers:
    """Tests for DELETE /api/plugins/honcho-dashboard/peers/all"""

    def test_returns_confirmation_without_confirm(self):
        """Without ?confirm=true, should return confirmation_required."""
        resp = client.delete(f"{API_PREFIX}/peers/all", headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["confirmation_required"] is True
        assert "peer_count" in data

    def test_returns_200_with_confirm(self):
        """With ?confirm=true, should delete all peers."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = []  # No peers
            mock_cursor.fetchone.return_value = [0]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/peers/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True

    def test_deletes_all_peers_cascade(self):
        """Should delete all peers and their associated data."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = [("peer1",), ("peer2",)]
            mock_cursor.fetchone.return_value = [2]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/peers/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["peer_count"] == 2
            # Should have executed SQL for each peer (7 queries per peer)
            assert mock_cursor.execute.call_count >= 14  # 2 peers * 7 queries

    def test_empty_workspace(self):
        """Deleting all peers when none exist should succeed."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = []
            mock_cursor.fetchone.return_value = [0]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/peers/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True


# =================================================================== #
# DELETE /sessions/all
# =================================================================== #

class TestDeleteAllSessions:
    """Tests for DELETE /api/plugins/honcho-dashboard/sessions/all"""

    def test_returns_confirmation_without_confirm(self):
        """Without ?confirm=true, should return confirmation_required."""
        resp = client.delete(f"{API_PREFIX}/sessions/all", headers=auth_headers())
        assert resp.status_code == 200
        data = resp.json()
        assert data["confirmation_required"] is True
        assert "session_count" in data

    def test_returns_200_with_confirm(self):
        """With ?confirm=true, should delete all sessions."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = []  # No sessions
            mock_cursor.fetchone.return_value = [0]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/sessions/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True

    def test_deletes_all_sessions_cascade(self):
        """Should delete all sessions and their associated data."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = [("session1",), ("session2",)]
            mock_cursor.fetchone.return_value = [2]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/sessions/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["session_count"] == 2
            # Should have executed SQL for each session (6 queries per session)
            assert mock_cursor.execute.call_count >= 12  # 2 sessions * 6 queries

    def test_empty_workspace(self):
        """Deleting all sessions when none exist should succeed."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = []
            mock_cursor.fetchone.return_value = [0]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/sessions/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True


# =================================================================== #
# DELETE /conclusions/all
# =================================================================== #

class TestDeleteAllConclusions:
    """Tests for DELETE /api/plugins/honcho-dashboard/conclusions/all"""

    def test_returns_confirmation_without_confirm(self):
        """Without ?confirm=true, should return confirmation_required."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"items": [{"id": "c1"}, {"id": "c2"}]}
            resp = client.delete(f"{API_PREFIX}/conclusions/all", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["confirmation_required"] is True
            assert data["conclusion_count"] == 2

    def test_returns_200_with_confirm(self):
        """With ?confirm=true, should delete all conclusions."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post, \
             patch("dashboard.plugin_api.honcho_delete") as mock_delete:
            mock_post.return_value = {"items": [{"id": "c1"}, {"id": "c2"}]}
            mock_delete.return_value = {}
            resp = client.delete(f"{API_PREFIX}/conclusions/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["deleted"] == 2

    def test_empty_workspace(self):
        """Deleting all conclusions when none exist should succeed."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post:
            mock_post.return_value = {"items": []}
            resp = client.delete(f"{API_PREFIX}/conclusions/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["deleted"] == 0

    def test_handles_delete_errors(self):
        """Should count errors when individual deletes fail."""
        with patch("dashboard.plugin_api.honcho_post") as mock_post, \
             patch("dashboard.plugin_api.honcho_delete") as mock_delete:
            mock_post.return_value = {"items": [{"id": "c1"}, {"id": "c2"}, {"id": "c3"}]}
            # First succeeds, second fails, third succeeds
            mock_delete.side_effect = [{}, Exception("fail"), {}]
            resp = client.delete(f"{API_PREFIX}/conclusions/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["deleted"] == 2
            assert data["errors"] == 1
            assert data["total"] == 3


# =================================================================== #
# Delete All Integration Tests
# =================================================================== #

class TestDeleteAllIntegration:
    """Integration tests for delete all endpoints."""

    def test_all_three_endpoints_require_confirmation(self):
        """All three delete-all endpoints should require confirmation."""
        endpoints = ["/peers/all", "/sessions/all", "/conclusions/all"]
        for endpoint in endpoints:
            resp = client.delete(f"{API_PREFIX}{endpoint}", headers=auth_headers())
            assert resp.status_code == 200
            data = resp.json()
            assert data["confirmation_required"] is True, f"{endpoint} should require confirmation"

    def test_delete_all_peers_then_list_empty(self):
        """After deleting all peers, GET /peers should return empty list."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = []
            mock_cursor.fetchone.return_value = [0]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/peers/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_delete_all_sessions_then_list_empty(self):
        """After deleting all sessions, GET /sessions should return empty list."""
        with patch("dashboard.plugin_api._db_connect") as mock_conn:
            mock_cursor = MagicMock()
            mock_cursor.fetchall.return_value = []
            mock_cursor.fetchone.return_value = [0]
            mock_conn.return_value.cursor.return_value = mock_cursor
            resp = client.delete(f"{API_PREFIX}/sessions/all?confirm=true", headers=auth_headers())
            assert resp.status_code == 200
            assert resp.json()["success"] is True
