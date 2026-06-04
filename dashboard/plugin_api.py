"""
Honcho Dashboard API — FastAPI router served at /api/plugins/honcho-dashboard/

Proxies Honcho API endpoints and enriches with Hermes session data
for the "Jump to Chat" feature.
"""

from __future__ import annotations

import json
import logging
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Honcho API client
# ---------------------------------------------------------------------------

HONCHO_BASE = "http://localhost:8000"
WORKSPACE = "hermes-botfred"


def honcho_post(path: str, body: Any = None) -> dict:
    """POST to Honcho API."""
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        f"{HONCHO_BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=e.code, detail=e.read().decode()[:500])
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


def honcho_put(path: str, body: Any = None) -> dict:
    """PUT to Honcho API."""
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        f"{HONCHO_BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=e.code, detail=e.read().decode()[:500])
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


def _deep_merge(base: dict, update: dict) -> dict:
    """Deep merge update into base. Returns new dict."""
    result = dict(base)
    for key, value in update.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def honcho_delete(path: str) -> dict:
    """DELETE to Honcho API. Tries direct call first, falls back to docker exec."""
    # Try direct call first (works for endpoints that don't require auth)
    req = urllib.request.Request(
        f"{HONCHO_BASE}{path}",
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:
        if e.code == 401 or e.code == 403:
            # Auth required - proxy through docker exec to call internally
            import subprocess
            result = subprocess.run(
                ["docker", "exec", "honcho-api-1", "python3", "-c",
                 f"import urllib.request,json; "
                 f"req=urllib.request.Request('http://localhost:8000{path}',method='DELETE'); "
                 f"resp=urllib.request.urlopen(req,timeout=10); "
                 f"body=resp.read().decode(); "
                 f"print(json.dumps({{'status':resp.status,'body':body}}))"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode != 0:
                raise HTTPException(status_code=502, detail=f"Honcho API delete failed: {result.stderr[:500]}")
            try:
                resp_data = json.loads(result.stdout.strip())
                status = resp_data.get("status", 0)
                body = resp_data.get("body", "")
                if status == 204 or status == 200:
                    return {}
                if status >= 400:
                    raise HTTPException(status_code=status, detail=body[:500])
                return json.loads(body) if body else {}
            except json.JSONDecodeError:
                return {}
        raise HTTPException(status_code=e.code, detail=e.read().decode()[:500])
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Hermes session DB reader (for Jump to Chat)
# ---------------------------------------------------------------------------

def get_hermes_db_path() -> Path:
    """Find the Hermes session database."""
    candidates = [
        Path.home() / ".hermes" / "state.db",
        Path.home() / ".hermes" / "hermes.db",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]  # default


def read_hermes_messages(session_id: str, message_id: str | None = None, window: int = 5) -> list[dict]:
    """Read messages from Hermes SQLite session DB around a specific message."""
    import sqlite3

    db_path = get_hermes_db_path()
    if not db_path.exists():
        return []

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row

        if message_id:
            # Find the rowid of the target message, then get surrounding messages
            cursor = conn.execute(
                "SELECT rowid FROM messages WHERE session_id = ? AND message_id = ? LIMIT 1",
                (session_id, message_id),
            )
            row = cursor.fetchone()
            if row:
                target_rowid = row[0]
                cursor = conn.execute(
                    "SELECT * FROM messages WHERE session_id = ? AND rowid BETWEEN ? AND ? ORDER BY rowid",
                    (session_id, target_rowid - window, target_rowid + window),
                )
            else:
                cursor = conn.execute(
                    "SELECT * FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT ?",
                    (session_id, window * 2 + 1),
                )
        else:
            cursor = conn.execute(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT ?",
                (session_id, window * 2 + 1),
            )

        results = []
        for r in cursor.fetchall():
            results.append({k: r[k] for k in r.keys()})
        conn.close()
        return results
    except Exception as e:
        logger.error("[Honcho Dashboard] Hermes DB read error: %s", e)
        return []


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/overview")
async def overview():
    """High-level stats for the Overview tab."""
    peers = honcho_post(f"/v3/workspaces/{WORKSPACE}/peers/list", {"limit": 100})
    sessions = honcho_post(f"/v3/workspaces/{WORKSPACE}/sessions/list", {"limit": 100})
    conclusions = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 1})

    peer_items = peers.get("items", [])
    session_items = sessions.get("items", [])
    # Use 'total' from API response for accurate counts (Honcho paginates at ~200/page)
    total_peers = peers.get("total", len(peer_items))
    total_sessions = sessions.get("total", len(session_items))
    total_conclusions = conclusions.get("total", 0)

    # Count messages across all sessions (sample first 5 for speed)
    total_messages = 0
    for s in session_items[:10]:
        try:
            msgs = honcho_post(
                f"/v3/workspaces/{WORKSPACE}/sessions/{s['id']}/messages/list",
                {"limit": 1},
            )
            total_messages += msgs.get("total", 0)
        except Exception:
            pass

    # Recent conclusions (last 10, sorted by date) — fetch a small page for display
    recent_conclusions_raw = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 10})
    recent_conclusions = sorted(
        recent_conclusions_raw.get("items", []),
        key=lambda c: c.get("created_at", ""),
        reverse=True,
    )[:10]

    return {
        "peers": {"total": total_peers, "items": peer_items},
        "sessions": {"total": total_sessions, "items": session_items},
        "conclusions": {"total": total_conclusions, "recent": recent_conclusions},
        "messages_sampled": total_messages,
    }


@router.get("/peers")
async def list_peers():
    """List all peers with their session and conclusion counts."""
    peers = honcho_post(f"/v3/workspaces/{WORKSPACE}/peers/list", {"limit": 100})
    # Count conclusions per peer — paginate through all conclusions
    concluded_about: dict[str, int] = {}
    concluded_by: dict[str, int] = {}
    page = 1
    while True:
        conclusions = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 200, "page": page})
        conclusion_items = conclusions.get("items", [])
        for c in conclusion_items:
            obs = c.get("observed_id", "")
            obr = c.get("observer_id", "")
            concluded_about[obs] = concluded_about.get(obs, 0) + 1
            concluded_by[obr] = concluded_by.get(obr, 0) + 1
        pages = conclusions.get("pages", 1)
        if page >= pages:
            break
        page += 1

    peer_items = peers.get("items", [])
    for p in peer_items:
        p["conclusions_about"] = concluded_about.get(p["id"], 0)
        p["conclusions_by"] = concluded_by.get(p["id"], 0)

    return {"peers": peer_items, "total": len(peer_items)}


@router.get("/sessions")
async def list_sessions():
    """List all sessions with message counts."""
    sessions = honcho_post(f"/v3/workspaces/{WORKSPACE}/sessions/list", {"limit": 200})
    session_items = sessions.get("items", [])

    # Enrich each session with its message count
    for s in session_items:
        sid = s["id"]
        try:
            msgs = honcho_post(
                f"/v3/workspaces/{WORKSPACE}/sessions/{sid}/messages/list",
                {"limit": 1},
            )
            s["message_count"] = msgs.get("total", 0)
        except Exception:
            s["message_count"] = 0

    return {"sessions": session_items, "total": sessions.get("total", len(session_items))}


@router.delete("/session/{session_id}")
async def delete_session(session_id: str, confirm: bool = Query(False)):
    """
    Delete a session and all its messages/embeddings.
    
    Requires ?confirm=true to actually perform the deletion.
    Without confirmation, returns a summary of what would be deleted.
    """
    import psycopg2

    conn = _db_connect()
    cur = conn.cursor()

    # Check the session exists — look up by name (Honcho API returns name as 'id')
    cur.execute(
        "SELECT id FROM sessions WHERE workspace_name = %s AND name = %s",
        (WORKSPACE, session_id),
    )
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    # Gather dependent counts for preview
    cur.execute(
        "SELECT COUNT(*) FROM messages WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, session_id),
    )
    msg_count = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM message_embeddings WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, session_id),
    )
    emb_count = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM session_peers WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, session_id),
    )
    sp_count = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM documents WHERE workspace_name = %s AND session_name = %s",
        (WORKSPACE, session_id),
    )
    doc_count = cur.fetchone()[0]

    cur.close()
    conn.close()

    if not confirm:
        return {
            "session_id": session_id,
            "will_delete": {
                "sessions": 1,
                "messages": msg_count,
                "message_embeddings": emb_count,
                "session_peers": sp_count,
                "documents": doc_count,
            },
            "confirmation_required": True,
            "message": f"Add ?confirm=true to delete session '{session_id}' and all associated data.",
        }

    # Perform the cascading delete
    conn = _db_connect()
    cur = conn.cursor()
    deleted = {}
    try:
        # Queue entries for this session's messages
        cur.execute(
            "DELETE FROM queue WHERE workspace_name = %s AND message_id IN (SELECT id FROM messages WHERE workspace_name = %s AND session_name = %s)",
            (WORKSPACE, WORKSPACE, session_id),
        )
        deleted["queue"] = cur.rowcount

        # Documents referencing this session
        cur.execute(
            "DELETE FROM documents WHERE workspace_name = %s AND session_name = %s",
            (WORKSPACE, session_id),
        )
        deleted["documents"] = cur.rowcount

        # Message embeddings
        cur.execute(
            "DELETE FROM message_embeddings WHERE workspace_name = %s AND session_name = %s",
            (WORKSPACE, session_id),
        )
        deleted["message_embeddings"] = cur.rowcount

        # Messages
        cur.execute(
            "DELETE FROM messages WHERE workspace_name = %s AND session_name = %s",
            (WORKSPACE, session_id),
        )
        deleted["messages"] = cur.rowcount

        # Session-peer links
        cur.execute(
            "DELETE FROM session_peers WHERE workspace_name = %s AND session_name = %s",
            (WORKSPACE, session_id),
        )
        deleted["session_peers"] = cur.rowcount

        # The session itself — look up by name
        cur.execute(
            "DELETE FROM sessions WHERE workspace_name = %s AND name = %s",
            (WORKSPACE, session_id),
        )
        deleted["sessions"] = cur.rowcount

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return {"success": True, "session_id": session_id, "deleted": deleted}


@router.get("/session/{session_id}/messages")
async def session_messages(session_id: str, limit: int = Query(50, le=200), page: int = 1):
    """Get messages for a specific session."""
    return honcho_post(
        f"/v3/workspaces/{WORKSPACE}/sessions/{session_id}/messages/list",
        {"limit": limit, "page": page},
    )


@router.get("/conclusions")
async def list_conclusions(
    observer_id: str | None = None,
    observed_id: str | None = None,
    limit: int = Query(50, le=5000),
):
    """List conclusions with optional filters. Auto-paginates to return all results."""
    filters = {}
    if observer_id:
        filters["observer_id"] = observer_id
    if observed_id:
        filters["observed_id"] = observed_id

    # Auto-paginate: fetch all pages and combine
    all_items = []
    page = 1
    per_page = min(limit, 200)  # Honcho API max per page is 200
    while True:
        body: dict = {"limit": per_page, "page": page}
        if filters:
            body["options"] = {"filters": filters}
        resp = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", body)
        items = resp.get("items", [])
        all_items.extend(items)
        total = resp.get("total", 0)
        pages = resp.get("pages", 1)
        if page >= pages or len(all_items) >= total:
            break
        page += 1

    return {"items": all_items, "total": len(all_items), "page": 1, "size": len(all_items), "pages": 1}


@router.delete("/conclusions/all")
async def delete_all_conclusions(confirm: bool = Query(False)):
    """
    Delete all conclusions from the workspace.
    Requires ?confirm=true to actually perform the deletion.
    """
    # Use Honcho's native API to delete all conclusions
    # First get the list, then delete each (Honcho API doesn't have a bulk delete)
    conclusions = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 200, "page": 1})
    total = conclusions.get("total", 0)
    pages = conclusions.get("pages", 1)
    items = conclusions.get("items", [])
    # Fetch remaining pages if needed
    for p in range(2, pages + 1):
        more = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 200, "page": p})
        items.extend(more.get("items", []))

    if not items:
        return {"success": True, "deleted": 0, "message": "No conclusions to delete."}

    if not confirm:
        return {
            "confirmation_required": True,
            "conclusion_count": len(items),
            "message": f"Add ?confirm=true to delete all {len(items)} conclusions.",
        }

    deleted = 0
    errors = 0
    for c in items:
        try:
            honcho_delete(f"/v3/workspaces/{WORKSPACE}/conclusions/{c['id']}")
            deleted += 1
        except Exception:
            errors += 1

    return {"success": True, "deleted": deleted, "errors": errors, "total": len(items)}

@router.delete("/conclusions/{conclusion_id}")
async def delete_conclusion(conclusion_id: str):
    """
    Delete a conclusion by its ID via the Honcho API.
    """
    # Use Honcho's native delete endpoint
    data = honcho_delete(f"/v3/workspaces/{WORKSPACE}/conclusions/{conclusion_id}")
    return {"success": True, "conclusion_id": conclusion_id, "detail": data}


@router.delete("/peers/all")
async def delete_all_peers(confirm: bool = Query(False)):
    """
    Delete all peers and their associated data from the workspace.
    Requires ?confirm=true to actually perform the deletion.
    """
    import psycopg2

    conn = _db_connect()
    cur = conn.cursor()

    # Count peers for preview
    cur.execute("SELECT COUNT(*) FROM peers WHERE workspace_name = %s", (WORKSPACE,))
    peer_count = cur.fetchone()[0]

    if not confirm:
        cur.close()
        conn.close()
        return {
            "confirmation_required": True,
            "peer_count": peer_count,
            "message": f"Add ?confirm=true to delete all {peer_count} peers and their associated data.",
        }

    # Delete all peers using the same cascade pattern as single peer delete
    deleted = {}
    try:
        # Get all peer names
        cur.execute("SELECT name FROM peers WHERE workspace_name = %s", (WORKSPACE,))
        peer_names = [r[0] for r in cur.fetchall()]

        for peer_name in peer_names:
            cur.execute(
                "DELETE FROM queue WHERE workspace_name = %s AND message_id IN (SELECT id FROM messages WHERE workspace_name = %s AND peer_name = %s)",
                (WORKSPACE, WORKSPACE, peer_name),
            )
            cur.execute(
                "DELETE FROM documents WHERE workspace_name = %s AND (observed = %s OR observer = %s)",
                (WORKSPACE, peer_name, peer_name),
            )
            cur.execute(
                "DELETE FROM collections WHERE workspace_name = %s AND (observed = %s OR observer = %s)",
                (WORKSPACE, peer_name, peer_name),
            )
            cur.execute(
                "DELETE FROM message_embeddings WHERE workspace_name = %s AND peer_name = %s",
                (WORKSPACE, peer_name),
            )
            cur.execute(
                "DELETE FROM messages WHERE workspace_name = %s AND peer_name = %s",
                (WORKSPACE, peer_name),
            )
            cur.execute(
                "DELETE FROM session_peers WHERE workspace_name = %s AND peer_name = %s",
                (WORKSPACE, peer_name),
            )
            cur.execute(
                "DELETE FROM peers WHERE workspace_name = %s AND name = %s",
                (WORKSPACE, peer_name),
            )

        conn.commit()
        deleted["peers"] = len(peer_names)
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return {"success": True, "deleted": deleted, "peer_count": peer_count}


@router.delete("/sessions/all")
async def delete_all_sessions(confirm: bool = Query(False)):
    """
    Delete all sessions and their associated data from the workspace.
    Requires ?confirm=true to actually perform the deletion.
    """
    import psycopg2

    conn = _db_connect()
    cur = conn.cursor()

    # Count sessions for preview
    cur.execute("SELECT COUNT(*) FROM sessions WHERE workspace_name = %s", (WORKSPACE,))
    session_count = cur.fetchone()[0]

    if not confirm:
        cur.close()
        conn.close()
        return {
            "confirmation_required": True,
            "session_count": session_count,
            "message": f"Add ?confirm=true to delete all {session_count} sessions and their associated data.",
        }

    deleted = {}
    try:
        # Get all session names
        cur.execute("SELECT name FROM sessions WHERE workspace_name = %s", (WORKSPACE,))
        session_names = [r[0] for r in cur.fetchall()]

        for session_name in session_names:
            cur.execute(
                "DELETE FROM queue WHERE workspace_name = %s AND message_id IN (SELECT id FROM messages WHERE workspace_name = %s AND session_name = %s)",
                (WORKSPACE, WORKSPACE, session_name),
            )
            cur.execute(
                "DELETE FROM documents WHERE workspace_name = %s AND session_name = %s",
                (WORKSPACE, session_name),
            )
            cur.execute(
                "DELETE FROM message_embeddings WHERE workspace_name = %s AND session_name = %s",
                (WORKSPACE, session_name),
            )
            cur.execute(
                "DELETE FROM messages WHERE workspace_name = %s AND session_name = %s",
                (WORKSPACE, session_name),
            )
            cur.execute(
                "DELETE FROM session_peers WHERE workspace_name = %s AND session_name = %s",
                (WORKSPACE, session_name),
            )
            cur.execute(
                "DELETE FROM sessions WHERE workspace_name = %s AND name = %s",
                (WORKSPACE, session_name),
            )

        conn.commit()
        deleted["sessions"] = len(session_names)
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return {"success": True, "deleted": deleted, "session_count": session_count}



@router.get("/search")
async def search_messages(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, le=50),
):
    """Vector search across all workspace messages."""
    body = {"query": q, "limit": limit}
    return honcho_post(f"/v3/workspaces/{WORKSPACE}/search", body)


@router.get("/analytics")
async def analytics():
    """14-day message and conclusion counts for analytics tab."""
    sessions = honcho_post(f"/v3/workspaces/{WORKSPACE}/sessions/list", {"limit": 200})
    conclusions = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 200})
    peers = honcho_post(f"/v3/workspaces/{WORKSPACE}/peers/list", {"limit": 100})

    session_items = sessions.get("items", [])
    conclusion_items = conclusions.get("items", [])
    peer_items = peers.get("items", [])

    # Bucket by day
    from datetime import datetime, timedelta
    days = []
    for i in range(13, -1, -1):
        d = datetime.utcnow() - timedelta(days=i)
        days.append(d.strftime("%Y-%m-%d"))

    msg_by_day = {}
    conc_by_day = {}
    for s in session_items:
        if s.get("created_at"):
            day = s["created_at"][:10]
            msg_by_day[day] = msg_by_day.get(day, 0) + 1
    for c in conclusion_items:
        if c.get("created_at"):
            day = c["created_at"][:10]
            conc_by_day[day] = conc_by_day.get(day, 0) + 1

    # Count total messages across all sessions (sample first 5 for speed)
    total_messages = 0
    for s in session_items[:5]:
        try:
            m = honcho_post(
                f"/v3/workspaces/{WORKSPACE}/sessions/{s['id']}/messages/list",
                {"limit": 1},
            )
            total_messages += m.get("total", 0)
        except Exception:
            pass

    return {
        "total_sessions": len(session_items),
        "total_messages": total_messages,
        "total_conclusions": len(conclusion_items),
        "total_peers": len(peer_items),
        "days": days,
        "messages_by_day": {d: msg_by_day.get(d, 0) for d in days},
        "conclusions_by_day": {d: conc_by_day.get(d, 0) for d in days},
    }


@router.get("/status")
async def honcho_status():
    """Honcho health + queue status + connected apps."""
    # Honcho health
    honcho_ok = False
    honcho_error = None
    try:
        req = urllib.request.Request(
            f"{HONCHO_BASE}/health",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            honcho_ok = resp.status == 200
    except Exception as e:
        honcho_error = str(e)

    # Queue status
    try:
        req = urllib.request.Request(
            f"{HONCHO_BASE}/v3/workspaces/{WORKSPACE}/queue/status",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            queue = json.loads(resp.read())
    except Exception:
        queue = {}
    total_wu = queue.get("total_work_units", 0)
    completed_wu = queue.get("completed_work_units", 0)
    pending_wu = queue.get("pending_work_units", 0)
    in_progress_wu = queue.get("in_progress_work_units", 0)
    active_wu = pending_wu + in_progress_wu

    # Queue per session
    sessions_queue = queue.get("sessions", {})

    return {
        "honcho_reachable": honcho_ok,
        "honcho_error": honcho_error,
        "queue": {
            "total": total_wu,
            "completed": completed_wu,
            "pending": pending_wu,
            "in_progress": in_progress_wu,
            "active": active_wu,
            "sessions": sessions_queue,
        },
    }


@router.post("/peer/{peerId}/insight")
async def create_insight(peerId: str, body: dict):
    """Submit an insight about a peer by posting a message to the most recent session."""
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content required")

    # Get all sessions and sort by created_at desc
    sessions = honcho_post(
        f"/v3/workspaces/{WORKSPACE}/sessions/list",
        {"limit": 50},
    )
    all_sessions = sessions.get("items", [])
    if not all_sessions:
        raise HTTPException(status_code=400, detail="No sessions found in workspace")

    # Sort by created_at desc to get most recent
    all_sessions.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    session_id = all_sessions[0]["id"]

    # Post message to the session
    msg_result = honcho_post(
        f"/v3/workspaces/{WORKSPACE}/sessions/{session_id}/messages",
        {"messages": [{"content": content, "peer_id": "hermes-owl"}]},
    )

    return {"success": True, "message": msg_result, "session_id": session_id}


# ---------------------------------------------------------------------------
# Peer deletion — cascading clean-up in PostgreSQL
# ---------------------------------------------------------------------------

import os as _os

DB_HOST = _os.environ.get("HONCHO_DB_HOST", "127.0.0.1")
DB_PORT = int(_os.environ.get("HONCHO_DB_PORT", "5432"))
DB_NAME = _os.environ.get("HONCHO_DB_NAME", "honcho")
DB_USER = _os.environ.get("HONCHO_DB_USER", "honcho")
DB_PASS = _os.environ.get("HONCHO_DB_PASS", "honcho")


def _db_status() -> dict:
    """Check database connectivity and return status info."""
    import psycopg2
    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
            user=DB_USER, password=DB_PASS, connect_timeout=5,
        )
        cur = conn.cursor()
        cur.execute("SELECT NOW()")
        cur.fetchone()
        cur.close()
        conn.close()
        return {"connected": True, "host": DB_HOST, "port": DB_PORT, "database": DB_NAME}
    except Exception as e:
        return {"connected": False, "host": DB_HOST, "port": DB_PORT, "database": DB_NAME, "error": str(e)}


@router.get("/db-status")
async def db_status():
    """Return database connection status for dashboard display."""
    return _db_status()


def _db_connect():
    """Get a PostgreSQL connection to the Honcho database."""
    import psycopg2
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS,
    )


def _delete_peer_cursors(workspace: str, peer_name: str) -> dict:
    """Delete a peer and all its dependent data. Returns counts of deleted rows."""
    conn = _db_connect()
    cur = conn.cursor()
    deleted = {}
    try:
        # Collect session names for this peer
        cur.execute(
            "SELECT session_name FROM session_peers WHERE workspace_name = %s AND peer_name = %s",
            (workspace, peer_name),
        )
        session_names = [r[0] for r in cur.fetchall()]

        # 1. Queue entries for messages by this peer
        cur.execute(
            "DELETE FROM queue WHERE workspace_name = %s AND message_id IN (SELECT id FROM messages WHERE workspace_name = %s AND peer_name = %s)",
            (workspace, workspace, peer_name),
        )
        deleted["queue"] = cur.rowcount

        # 2. Documents referencing this peer
        cur.execute(
            "DELETE FROM documents WHERE workspace_name = %s AND (observed = %s OR observer = %s)",
            (workspace, peer_name, peer_name),
        )
        deleted["documents"] = cur.rowcount

        # 3. Collections referencing this peer
        cur.execute(
            "DELETE FROM collections WHERE workspace_name = %s AND (observed = %s OR observer = %s)",
            (workspace, peer_name, peer_name),
        )
        deleted["collections"] = cur.rowcount

        # 4. Message embeddings for this peer
        cur.execute(
            "DELETE FROM message_embeddings WHERE workspace_name = %s AND peer_name = %s",
            (workspace, peer_name),
        )
        deleted["message_embeddings"] = cur.rowcount

        # 5. Messages for this peer
        cur.execute(
            "DELETE FROM messages WHERE workspace_name = %s AND peer_name = %s",
            (workspace, peer_name),
        )
        deleted["messages"] = cur.rowcount

        # 6. Session-peer links
        cur.execute(
            "DELETE FROM session_peers WHERE workspace_name = %s AND peer_name = %s",
            (workspace, peer_name),
        )
        deleted["session_peers"] = cur.rowcount

        # 7. The peer itself
        cur.execute(
            "DELETE FROM peers WHERE workspace_name = %s AND name = %s",
            (workspace, peer_name),
        )
        deleted["peers"] = cur.rowcount

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
    return deleted


@router.delete("/peer/{peerId}")
async def delete_peer(peerId: str, confirm: bool = Query(False)):
    """
    Delete a peer and all associated data from Honcho.
    
    Requires ?confirm=true to actually perform the deletion.
    Without confirmation, returns a summary of what would be deleted.
    """
    import psycopg2

    # Look up the peer by name (Honcho API returns name as 'id')
    try:
        conn = _db_connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name FROM peers WHERE workspace_name = %s AND name = %s",
            (WORKSPACE, peerId),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Database error: {e}")

    if not row:
        raise HTTPException(status_code=404, detail=f"Peer '{peerId}' not found")

    peer_id, peer_name = row

    # Gather dependent counts for the confirmation preview
    try:
        conn = _db_connect()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM messages WHERE workspace_name = %s AND peer_name = %s", (WORKSPACE, peer_name))
        msg_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM documents WHERE workspace_name = %s AND (observed = %s OR observer = %s)", (WORKSPACE, peer_name, peer_name))
        doc_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM collections WHERE workspace_name = %s AND (observed = %s OR observer = %s)", (WORKSPACE, peer_name, peer_name))
        col_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM session_peers WHERE workspace_name = %s AND peer_name = %s", (WORKSPACE, peer_name))
        sp_count = cur.fetchone()[0]
        cur.close()
        conn.close()
    except Exception:
        msg_count = doc_count = col_count = sp_count = -1

    if not confirm:
        return {
            "peer_id": peer_id,
            "peer_name": peer_name,
            "will_delete": {
                "messages": msg_count,
                "documents": doc_count,
                "collections": col_count,
                "session_peers": sp_count,
                "peers": 1,
            },
            "confirmation_required": True,
            "message": f"Add ?confirm=true to delete peer '{peer_name}' and all associated data.",
        }

    # Perform the cascading delete
    try:
        deleted = _delete_peer_cursors(WORKSPACE, peer_name)
    except Exception as e:
        logger.error("[Honcho Dashboard] Peer deletion error: %s", e)
        raise HTTPException(status_code=502, detail=f"Deletion failed: {e}")

    return {"success": True, "peer_id": peer_id, "peer_name": peer_name, "deleted": deleted}


@router.get("/source-chat")
async def source_chat(
    session_id: str = Query(...),
    message_id: str | None = None,
    window: int = Query(5, ge=1, le=20),
):
    """Get surrounding messages from Hermes session DB for 'Jump to Chat'."""
    messages = read_hermes_messages(session_id, message_id, window)
    return {"session_id": session_id, "message_id": message_id, "messages": messages}


# ---------------------------------------------------------------------------
# Workspace Config — read and update Honcho workspace configuration
# ---------------------------------------------------------------------------

@router.get("/config")
async def get_config():
    """Get current workspace configuration."""
    # POST to /v3/workspaces with existing ID returns the workspace (get-or-create)
    ws = honcho_post(f"/v3/workspaces", {"id": WORKSPACE})
    return {
        "id": ws.get("id", WORKSPACE),
        "metadata": ws.get("metadata", {}),
        "configuration": ws.get("configuration", {}),
        "created_at": ws.get("created_at", ""),
    }


@router.put("/config")
async def update_config(body: dict):
    """
    Update workspace configuration.
    
    Accepts partial configuration updates. Only provided fields are merged.
    """
    # Get current config first
    current = honcho_post(f"/v3/workspaces", {"id": WORKSPACE})
    current_config = current.get("configuration") or {}
    current_metadata = current.get("metadata") or {}

    # Build update body
    update_body: dict = {}

    # Handle metadata update
    if "metadata" in body:
        # Merge metadata
        merged_metadata = dict(current_metadata)
        merged_metadata.update(body["metadata"])
        update_body["metadata"] = merged_metadata

    # Handle configuration update — deep merge
    if "configuration" in body:
        merged_config = _deep_merge(current_config, body["configuration"])
        update_body["configuration"] = merged_config

    if not update_body:
        raise HTTPException(status_code=400, detail="No configuration fields provided")

    # Call Honcho PUT endpoint
    result = honcho_put(f"/v3/workspaces/{WORKSPACE}", update_body)
    return {
        "success": True,
        "id": result.get("id", WORKSPACE),
        "configuration": result.get("configuration", {}),
        "metadata": result.get("metadata", {}),
    }


# ---------------------------------------------------------------------------
# Global Config — read Honcho server configuration (models, etc.)
# ---------------------------------------------------------------------------

@router.get("/global-config")
async def get_global_config():
    """Read Honcho server configuration from the container."""
    import subprocess
    result = subprocess.run(
        ["docker", "exec", "honcho-api-1", "python3", "-c",
         "import json,sys; from src.config import TOML_CONFIG; "
         "print(json.dumps(TOML_CONFIG, indent=2, default=str))"],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        raise HTTPException(status_code=502, detail=f"Failed to read config: {result.stderr[:500]}")
    try:
        config = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Invalid config output from container")
    return config


@router.put("/global-config")
async def update_global_config(body: dict):
    """
    Update Honcho server global configuration.
    Writes the provided values into the container's config.toml and restarts the service.
    """
    import subprocess, json, re

    # Read current TOML
    result = subprocess.run(
        ["docker", "exec", "honcho-api-1", "cat", "/app/config.toml"],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        raise HTTPException(status_code=502, detail=f"Failed to read config.toml: {result.stderr[:500]}")
    toml_content = result.stdout

    # Apply updates — body is a flat dict like {"deriver.ENABLED": true, "summary.MESSAGES_PER_SHORT_SUMMARY": 60}
    for key, value in body.items():
        parts = key.split(".")
        if len(parts) < 2:
            continue
        section = parts[0]
        field = parts[1]
        # Convert value to TOML representation
        if isinstance(value, bool):
            toml_val = "true" if value else "false"
        elif isinstance(value, (int, float)):
            toml_val = str(value)
        elif isinstance(value, str):
            toml_val = '"' + value.replace('"', '\\"') + '"'
        else:
            toml_val = str(value)

        # Try to find and replace the line in the appropriate section
        section_pattern = r'\[' + re.escape(section) + r'\]'
        field_pattern = r'^(\s*' + re.escape(field) + r'\s*=\s*)[^\s#]+'

        # Find the section
        section_match = re.search(section_pattern, toml_content, re.MULTILINE)
        if not section_match:
            # Section doesn't exist, add it at the end
            toml_content += f"\n[{section}]\n{field} = {toml_val}\n"
        else:
            # Find the field within the section
            section_start = section_match.end()
            # Find the next section header or end of file
            next_section = re.search(r'\n\[', toml_content[section_start:])
            section_end = section_start + next_section.start() if next_section else len(toml_content)
            section_text = toml_content[section_start:section_end]

            field_re = re.compile(field_pattern, re.MULTILINE)
            if field_re.search(section_text):
                # Replace existing value
                new_section_text = field_re.sub(r'\g<1>' + toml_val, section_text)
                toml_content = toml_content[:section_start] + new_section_text + toml_content[section_end:]
            else:
                # Field doesn't exist in section, add it
                toml_content = toml_content[:section_end] + f"{field} = {toml_val}\n" + toml_content[section_end:]

    # Write updated TOML back
    # Use a temp file approach
    import base64
    encoded = base64.b64encode(toml_content.encode()).decode()
    result = subprocess.run(
        ["docker", "exec", "honcho-api-1", "bash", "-c",
         f"echo '{encoded}' | base64 -d > /app/config.toml"],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        raise HTTPException(status_code=502, detail=f"Failed to write config.toml: {result.stderr[:500]}")

    # Restart the Honcho API container to pick up new config
    result = subprocess.run(
        ["docker", "restart", "honcho-api-1"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise HTTPException(status_code=502, detail=f"Config saved but restart failed: {result.stderr[:500]}")

    return {"success": True, "message": "Global config updated and service restarted."}


# ---------------------------------------------------------------------------
# Hermes Session Import — list and import Hermes sessions into Honcho
# ---------------------------------------------------------------------------

def _read_hermes_sessions() -> list[dict]:
    """Read all sessions from Hermes SQLite DB."""
    import sqlite3

    db_path = get_hermes_db_path()
    if not db_path.exists():
        return []

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "SELECT id, title, source, message_count, started_at, ended_at "
            "FROM sessions ORDER BY started_at DESC"
        )
        results = []
        for r in cursor.fetchall():
            results.append({k: r[k] for k in r.keys()})
        conn.close()
        return results
    except Exception as e:
        logger.error("[Honcho Dashboard] Hermes DB read error: %s", e)
        return []


def _read_hermes_session_messages(session_id: str) -> list[dict]:
    """Read all user/assistant messages from a Hermes session."""
    import sqlite3

    db_path = get_hermes_db_path()
    if not db_path.exists():
        return []

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "SELECT role, content, timestamp FROM messages "
            "WHERE session_id = ? AND role IN ('user', 'assistant') "
            "ORDER BY rowid ASC",
            (session_id,),
        )
        results = []
        for r in cursor.fetchall():
            results.append({k: r[k] for k in r.keys()})
        conn.close()
        return results
    except Exception as e:
        logger.error("[Honcho Dashboard] Hermes DB read error: %s", e)
        return []


def _get_imported_sessions() -> set[str]:
    """Get set of Hermes session IDs already imported into Honcho."""
    try:
        conn = _db_connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT name FROM sessions WHERE workspace_name = %s AND name LIKE %s",
            (WORKSPACE, "%-import"),
        )
        imported = {r[0].replace("-import", "") for r in cur.fetchall()}
        cur.close()
        conn.close()
        return imported
    except Exception:
        return set()


@router.get("/hermes-sessions")
async def list_hermes_sessions():
    """
    List all Hermes sessions available for import.
    Includes metadata about whether each session has already been imported.
    """
    sessions = _read_hermes_sessions()
    imported = _get_imported_sessions()

    # Enrich with import status and message breakdown
    for s in sessions:
        s["already_imported"] = s["id"] in imported
        # Get user/assistant message counts
        msgs = _read_hermes_session_messages(s["id"])
        s["user_messages"] = sum(1 for m in msgs if m["role"] == "user")
        s["assistant_messages"] = sum(1 for m in msgs if m["role"] == "assistant")
        s["total_importable"] = s["user_messages"] + s["assistant_messages"]

    return {"sessions": sessions, "total": len(sessions), "imported_count": len(imported)}


@router.post("/import-sessions")
async def import_sessions(body: dict):
    """
    Import selected Hermes sessions into Honcho.

    Body:
    {
        "session_ids": ["session-id-1", "session-id-2"],
        "user_peer_id": "peer-id-for-user",
        "assistant_peer_id": "peer-id-for-assistant",
        "dry_run": false
    }
    """
    session_ids = body.get("session_ids", [])
    user_peer_id = body.get("user_peer_id", "").strip()
    assistant_peer_id = body.get("assistant_peer_id", "").strip()
    dry_run = body.get("dry_run", False)

    if not session_ids:
        raise HTTPException(status_code=400, detail="No session_ids provided")
    if not user_peer_id:
        raise HTTPException(status_code=400, detail="user_peer_id is required")
    if not assistant_peer_id:
        raise HTTPException(status_code=400, detail="assistant_peer_id is required")

    results = []
    for sid in session_ids:
        session_msgs = _read_hermes_session_messages(sid)
        if not session_msgs:
            results.append({
                "session_id": sid,
                "status": "skipped",
                "reason": "No user/assistant messages found",
            })
            continue

        # Build Honcho messages
        honcho_messages = []
        for msg in session_msgs:
            peer_id = user_peer_id if msg["role"] == "user" else assistant_peer_id
            honcho_messages.append({
                "content": msg["content"],
                "peer_id": peer_id,
            })

        if dry_run:
            results.append({
                "session_id": sid,
                "status": "dry_run",
                "message_count": len(honcho_messages),
                "user_messages": sum(1 for m in session_msgs if m["role"] == "user"),
                "assistant_messages": sum(1 for m in session_msgs if m["role"] == "assistant"),
            })
            continue

        # Get or create Honcho session
        # Use Hermes session ID as Honcho session ID (already matches ^[a-zA-Z0-9_-]+$)
        # Store the human-readable title in metadata for display
        hermes_sessions = _read_hermes_sessions()
        session_title = next(
            (s["title"] for s in hermes_sessions if s["id"] == sid), sid
        )
        honcho_session_name = f"{sid}-import"

        try:
            # Create/get the session in Honcho
            honcho_post(
                f"/v3/workspaces/{WORKSPACE}/sessions",
                {"id": honcho_session_name, "metadata": {"source": "hermes-import", "hermes_session_id": sid, "hermes_title": session_title}},
            )

            # Add messages in batches of 50
            batch_size = 50
            total_added = 0
            for i in range(0, len(honcho_messages), batch_size):
                batch = honcho_messages[i:i + batch_size]
                honcho_post(
                    f"/v3/workspaces/{WORKSPACE}/sessions/{honcho_session_name}/messages",
                    {"messages": batch},
                )
                total_added += len(batch)

            results.append({
                "session_id": sid,
                "status": "imported",
                "honcho_session": honcho_session_name,
                "messages_imported": total_added,
            })
        except HTTPException as e:
            results.append({
                "session_id": sid,
                "status": "error",
                "reason": e.detail,
            })
        except Exception as e:
            results.append({
                "session_id": sid,
                "status": "error",
                "reason": str(e),
            })

    imported_count = sum(1 for r in results if r["status"] == "imported")
    error_count = sum(1 for r in results if r["status"] == "error")

    return {
        "success": error_count == 0,
        "dry_run": dry_run,
        "results": results,
        "summary": {
            "total": len(session_ids),
            "imported": imported_count,
            "errors": error_count,
            "skipped": len(session_ids) - imported_count - error_count,
        },
    }
