"""
Backend unit tests for the delete features in the Honcho Dashboard plugin.

Tests the DELETE /peer/{peerId} and DELETE /session/{session_id} endpoints:
  - Preview mode (no confirm) returns will_delete counts
  - Confirm mode performs cascading deletion
  - 404 for non-existent peer/session
  - DB status endpoint returns connection info
"""
from __future__ import annotations

import base64
import os
import pytest
from fastapi.testclient import TestClient

# --------------------------------------------------------------------------- #
# App setup
# --------------------------------------------------------------------------- #
# The plugin_api module creates `router` which is mounted at
# /api/plugins/honcho-dashboard/.  For unit tests we import the router
# and mount it on a bare FastAPI app so we can use TestClient.

from fastapi import FastAPI
from dashboard.plugin_api import router

app = FastAPI()
app.include_router(router, prefix="/api/plugins/honcho-dashboard")

client = TestClient(app, raise_server_exceptions=False)

API_PREFIX = "/api/plugins/honcho-dashboard"


# --------------------------------------------------------------------------- #
# Helpers: create / destroy test data directly in PostgreSQL
# --------------------------------------------------------------------------- #
def _db():
    """Return a psycopg2 connection using the same env vars as the plugin."""
    import psycopg2
    return psycopg2.connect(
        host=os.environ.get("HONCHO_DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("HONCHO_DB_PORT", "5432")),
        dbname=os.environ.get("HONCHO_DB_NAME", "honcho"),
        user=os.environ.get("HONCHO_DB_USER", "honcho"),
        password=os.environ.get("HONCHO_DB_PASS", "honcho"),
    )


WORKSPACE = os.environ.get("HONCHO_WORKSPACE", "hermes-botfred")


def _make_id() -> str:
    """Generate a 21-character Honcho-compatible peer ID."""
    import base64
    import os
    return base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")[:21]


def _make_test_peer(name: str, msg_count: int = 2) -> str:
    """
    Insert a test peer + sessions + messages into the DB.
    Returns the peer name for cleanup.
    """
    conn = _db()
    cur = conn.cursor()
    pid = _make_id()

    # Peer
    cur.execute(
        "INSERT INTO peers (workspace_name, id, name) VALUES (%s, %s, %s)",
        (WORKSPACE, pid, name),
    )

    # Session
    sid = _make_id()
    cur.execute(
        "INSERT INTO sessions (workspace_name, id, name) VALUES (%s, %s, %s)",
        (WORKSPACE, sid, sid),
    )

    # Session-peer link
    cur.execute(
        "INSERT INTO session_peers (workspace_name, session_name, peer_name) VALUES (%s, %s, %s)",
        (WORKSPACE, sid, name),
    )

    # Messages — bigint id, all NOT NULL cols provided
    for i in range(msg_count):
        cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM messages WHERE workspace_name = %s", (WORKSPACE,))
        mid = cur.fetchone()[0] + i
        pid = _make_id()
        seq = i + 1
        cur.execute(
            "INSERT INTO messages (workspace_name, id, public_id, session_name, peer_name, content, seq_in_session, metadata, internal_metadata, token_count) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (WORKSPACE, mid, pid, sid, name, f"test message {i}", seq, '{}', '{}', len(f"test message {i}".split())),
        )

    conn.commit()
    cur.close()
    conn.close()
    return name


def _cleanup_peer(name: str):
    """Remove a test peer and all its data (best-effort)."""
    conn = _db()
    cur = conn.cursor()
    # Get session names
    cur.execute(
        "SELECT session_name FROM session_peers WHERE workspace_name = %s AND peer_name = %s",
        (WORKSPACE, name),
    )
    sessions = [r[0] for r in cur.fetchall()]

    # Delete messages → embeddings → session_peers → sessions → peer
    cur.execute(
        "DELETE FROM messages WHERE workspace_name = %s AND peer_name = %s",
        (WORKSPACE, name),
    )
    cur.execute(
        "DELETE FROM message_embeddings WHERE workspace_name = %s AND peer_name = %s",
        (WORKSPACE, name),
    )
    cur.execute(
        "DELETE FROM session_peers WHERE workspace_name = %s AND peer_name = %s",
        (WORKSPACE, name),
    )
    cur.execute(
        "DELETE FROM documents WHERE workspace_name = %s AND (observed = %s OR observer = %s)",
        (WORKSPACE, name, name),
    )
    cur.execute(
        "DELETE FROM peers WHERE workspace_name = %s AND name = %s",
        (WORKSPACE, name),
    )
    # Clean sessions that belong only to this peer
    for s in sessions:
        cur.execute(
            "DELETE FROM messages WHERE workspace_name = %s AND session_name = %s",
            (WORKSPACE, s),
        )
        cur.execute(
            "DELETE FROM message_embeddings WHERE workspace_name = %s AND session_name = %s",
            (WORKSPACE, s),
        )
        cur.execute(
            "DELETE FROM session_peers WHERE workspace_name = %s AND session_name = %s",
            (WORKSPACE, s),
        )
        cur.execute(
            "DELETE FROM sessions WHERE workspace_name = %s AND id = %s",
            (WORKSPACE, s),
        )

    conn.commit()
    cur.close()
    conn.close()


def _make_test_session(with_messages: bool = False) -> str:
    """Insert a test session, optionally with messages. Returns session_id."""
    conn = _db()
    cur = conn.cursor()
    sid = _make_id()

    cur.execute(
        "INSERT INTO sessions (workspace_name, id, name) VALUES (%s, %s, %s)",
        (WORKSPACE, sid, sid),
    )

    if with_messages:
        # Create a peer first (messages has FK to peers)
        peer_name = f"test-session-peer-{_make_id()[:8]}"
        peer_id = _make_id()
        cur.execute(
            "INSERT INTO peers (workspace_name, id, name) VALUES (%s, %s, %s)",
            (WORKSPACE, peer_id, peer_name),
        )
        cur.execute(
            "INSERT INTO session_peers (workspace_name, session_name, peer_name) VALUES (%s, %s, %s)",
            (WORKSPACE, sid, peer_name),
        )
        cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM messages WHERE workspace_name = %s", (WORKSPACE,))
        mid = cur.fetchone()[0]
        pid = _make_id()
        cur.execute(
            "INSERT INTO messages (workspace_name, id, public_id, session_name, peer_name, content, seq_in_session, metadata, internal_metadata, token_count) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (WORKSPACE, mid, pid, sid, peer_name, "hello", 1, '{}', '{}', 1),
        )
        # Store peer name for cleanup
        _make_test_session._last_peer = peer_name

    conn.commit()
    cur.close()
    conn.close()
    return sid


def _cleanup_session(sid: str):
    """Remove a test session and all its data (best-effort), plus any
    helper peer created by _make_test_session."""
    conn = _db()
    cur = conn.cursor()
    # Get peer names for this session
    cur.execute(
        "SELECT peer_name FROM session_peers WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, sid),
    )
    peers = [r[0] for r in cur.fetchall()]

    cur.execute(
        "DELETE FROM messages WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, sid),
    )
    cur.execute(
        "DELETE FROM message_embeddings WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, sid),
    )
    cur.execute(
        "DELETE FROM session_peers WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, sid),
    )
    cur.execute(
        "DELETE FROM documents WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, sid),
    )
    cur.execute(
        "DELETE FROM sessions WHERE workspace_name = %s AND id = %s",
        (WORKSPACE, sid),
    )
    # Clean up test peers that were created alongside this session
    for pname in peers:
        if pname.startswith("test-session-peer-"):
            cur.execute(
                "DELETE FROM messages WHERE workspace_name = %s AND peer_name = %s",
                (WORKSPACE, pname),
            )
            cur.execute(
                "DELETE FROM message_embeddings WHERE workspace_name = %s AND peer_name = %s",
                (WORKSPACE, pname),
            )
            cur.execute(
                "DELETE FROM session_peers WHERE workspace_name = %s AND peer_name = %s",
                (WORKSPACE, pname),
            )
            cur.execute(
                "DELETE FROM documents WHERE workspace_name = %s AND (observed = %s OR observer = %s)",
                (WORKSPACE, pname, pname),
            )
            cur.execute(
                "DELETE FROM peers WHERE workspace_name = %s AND name = %s",
                (WORKSPACE, pname),
            )
    conn.commit()
    cur.close()
    conn.close()


# =================================================================== #
# DB STATUS
# =================================================================== #

class TestDbStatus:
    """Tests for GET /api/plugins/honcho-dashboard/db-status"""

    def test_db_status_returns_connected(self):
        resp = client.get(f"{API_PREFIX}/db-status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is True
        assert "host" in data
        assert "port" in data
        assert "database" in data

    def test_db_status_returns_expected_fields(self):
        """The db-status endpoint should always return the core fields."""
        resp = client.get(f"{API_PREFIX}/db-status")
        assert resp.status_code == 200
        data = resp.json()
        assert "connected" in data
        assert "host" in data
        assert "port" in data
        assert "database" in data
        # When connected, there should be no error field
        if data["connected"]:
            assert data.get("error") is None


# =================================================================== #
# DELETE PEER
# =================================================================== #

class TestDeletePeer:
    """Tests for DELETE /api/plugins/honcho-dashboard/peer/{peerId}"""

    PEER_NAME = f"test-peer-{base64.urlsafe_b64encode(os.urandom(6)).decode().rstrip('='[:8])}"

    @pytest.fixture(autouse=True)
    def setup_teardown(self):
        """Create a test peer before each test, clean up after."""
        _make_test_peer(self.PEER_NAME, msg_count=3)
        yield
        _cleanup_peer(self.PEER_NAME)

    def test_preview_returns_will_delete_without_confirm(self):
        """Without ?confirm=true, endpoint returns preview data (not deleted)."""
        resp = client.delete(f"{API_PREFIX}/peer/{self.PEER_NAME}")
        assert resp.status_code == 200
        data = resp.json()

        # Preview mode
        assert data["confirmation_required"] is True
        assert "will_delete" in data
        assert data["will_delete"]["peers"] == 1
        assert data["will_delete"]["messages"] == 3
        assert "Add ?confirm=true" in data["message"]

        # Verify peer still exists in DB
        conn2 = _db()
        cur2 = conn2.cursor()
        cur2.execute(
            "SELECT id FROM peers WHERE workspace_name = %s AND name = %s",
            (WORKSPACE, self.PEER_NAME),
        )
        assert cur2.fetchone() is not None, "Peer should still exist after preview"
        cur2.close()
        conn2.close()

    def test_confirm_deletes_peer_and_all_data(self):
        """With ?confirm=true, the peer and all its data are deleted."""
        resp = client.delete(f"{API_PREFIX}/peer/{self.PEER_NAME}?confirm=true")
        assert resp.status_code == 200
        data = resp.json()

        assert data["success"] is True
        assert data["peer_name"] == self.PEER_NAME
        assert "deleted" in data
        assert data["deleted"]["peers"] == 1
        assert data["deleted"]["messages"] == 3

        # Verify peer is gone from DB
        conn2 = _db()
        cur2 = conn2.cursor()
        cur2.execute(
            "SELECT id FROM peers WHERE workspace_name = %s AND name = %s",
            (WORKSPACE, self.PEER_NAME),
        )
        assert cur2.fetchone() is None, "Peer should be deleted"

        # Verify messages are gone
        cur2.execute(
            "SELECT COUNT(*) FROM messages WHERE workspace_name = %s AND peer_name = %s",
            (WORKSPACE, self.PEER_NAME),
        )
        assert cur2.fetchone()[0] == 0, "Messages should be deleted"

        # Verify session_peers are gone
        cur2.execute(
            "SELECT COUNT(*) FROM session_peers WHERE workspace_name = %s AND peer_name = %s",
            (WORKSPACE, self.PEER_NAME),
        )
        assert cur2.fetchone()[0] == 0, "Session-peer links should be deleted"
        cur2.close()
        conn2.close()

    def test_delete_nonexistent_peer_returns_404(self):
        resp = client.delete(f"{API_PREFIX}/peer/does-not-exist-12345")
        assert resp.status_code == 404

    def test_delete_peer_cascading_order(self):
        """
        Verify that deleting a peer properly cascades:
        queue → documents → collections → message_embeddings → messages → session_peers → peers
        """
        resp = client.delete(f"{API_PREFIX}/peer/{self.PEER_NAME}?confirm=true")
        assert resp.status_code == 200
        data = resp.json()

        # All the cascade keys should be present in the response
        deleted = data["deleted"]
        expected_keys = {"queue", "documents", "collections", "message_embeddings", "messages", "session_peers", "peers"}
        assert expected_keys.issubset(set(deleted.keys())), f"Missing keys: {expected_keys - set(deleted.keys())}"


# =================================================================== #
# DELETE SESSION
# =================================================================== #

class TestDeleteSession:
    """Tests for DELETE /api/plugins/honcho-dashboard/session/{session_id}"""

    SESSION_ID = None

    @pytest.fixture(autouse=True)
    def setup_teardown(self):
        sid = _make_test_session(with_messages=False)
        self.__class__.SESSION_ID = sid
        yield
        _cleanup_session(sid)

    def test_preview_returns_will_delete_without_confirm(self):
        sid = self.SESSION_ID
        resp = client.delete(f"{API_PREFIX}/session/{sid}")
        assert resp.status_code == 200
        data = resp.json()

        assert data["confirmation_required"] is True
        assert "will_delete" in data
        assert data["will_delete"]["sessions"] == 1
        assert data["will_delete"]["messages"] == 0
        assert "Add ?confirm=true" in data["message"]

        # Verify session still exists
        conn = _db()
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM sessions WHERE workspace_name = %s AND id = %s",
            (WORKSPACE, sid),
        )
        assert cur.fetchone() is not None, "Session should still exist after preview"
        cur.close()
        conn.close()

    def test_confirm_deletes_empty_session(self):
        sid = self.SESSION_ID
        resp = client.delete(f"{API_PREFIX}/session/{sid}?confirm=true")
        assert resp.status_code == 200
        data = resp.json()

        assert data["success"] is True
        assert data["session_id"] == sid
        assert data["deleted"]["sessions"] == 1

        # Verify session is gone
        conn = _db()
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM sessions WHERE workspace_name = %s AND id = %s",
            (WORKSPACE, sid),
        )
        assert cur.fetchone() is None, "Session should be deleted"
        cur.close()
        conn.close()

    def test_delete_session_with_messages(self):
        """Create a session with messages, delete it, verify messages are gone."""
        sid = _make_test_session(with_messages=True)
        try:
            resp = client.delete(f"{API_PREFIX}/session/{sid}?confirm=true")
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["deleted"]["messages"] >= 1

            # Verify messages are gone
            conn = _db()
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*) FROM messages WHERE workspace_name = %s AND session_name = %s",
                (WORKSPACE, sid),
            )
            assert cur.fetchone()[0] == 0, "Messages should be deleted"
            cur.close()
            conn.close()
        finally:
            _cleanup_session(sid)

    def test_delete_nonexistent_session_returns_404(self):
        resp = client.delete(f"{API_PREFIX}/session/does-not-exist-xyz")
        assert resp.status_code == 404

    def test_delete_session_cascading_order(self):
        """Verify all cascade keys are present in the deleted response."""
        sid = _make_test_session(with_messages=True)
        try:
            resp = client.delete(f"{API_PREFIX}/session/{sid}?confirm=true")
            assert resp.status_code == 200
            data = resp.json()

            deleted = data["deleted"]
            expected_keys = {"queue", "documents", "message_embeddings", "messages", "session_peers", "sessions"}
            assert expected_keys.issubset(set(deleted.keys())), f"Missing keys: {expected_keys - set(deleted.keys())}"
        finally:
            _cleanup_session(sid)
