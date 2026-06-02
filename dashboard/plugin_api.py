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
    conclusions = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 100})

    peer_items = peers.get("items", [])
    session_items = sessions.get("items", [])
    conclusion_items = conclusions.get("items", [])

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

    # Recent conclusions (last 10, sorted by date)
    recent_conclusions = sorted(
        conclusion_items,
        key=lambda c: c.get("created_at", ""),
        reverse=True,
    )[:10]

    return {
        "peers": {"total": len(peer_items), "items": peer_items},
        "sessions": {"total": len(session_items), "items": session_items},
        "conclusions": {"total": len(conclusion_items), "recent": recent_conclusions},
        "messages_sampled": total_messages,
    }


@router.get("/peers")
async def list_peers():
    """List all peers with their session and conclusion counts."""
    peers = honcho_post(f"/v3/workspaces/{WORKSPACE}/peers/list", {"limit": 100})
    conclusions = honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", {"limit": 100})

    conclusion_items = conclusions.get("items", [])

    # Count conclusions per peer (as observed)
    concluded_about: dict[str, int] = {}
    concluded_by: dict[str, int] = {}
    for c in conclusion_items:
        obs = c.get("observed_id", "")
        obr = c.get("observer_id", "")
        concluded_about[obs] = concluded_about.get(obs, 0) + 1
        concluded_by[obr] = concluded_by.get(obr, 0) + 1

    peer_items = peers.get("items", [])
    for p in peer_items:
        p["conclusions_about"] = concluded_about.get(p["id"], 0)
        p["conclusions_by"] = concluded_by.get(p["id"], 0)

    return {"peers": peer_items, "total": len(peer_items)}


@router.get("/sessions")
async def list_sessions():
    """List all sessions grouped by peer."""
    sessions = honcho_post(f"/v3/workspaces/{WORKSPACE}/sessions/list", {"limit": 100})
    return {"sessions": sessions.get("items", []), "total": sessions.get("total", 0)}


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
    limit: int = Query(50, le=200),
):
    """List conclusions with optional filters."""
    body: dict = {"limit": limit}
    filters = {}
    if observer_id:
        filters["observer_id"] = observer_id
    if observed_id:
        filters["observed_id"] = observed_id
    if filters:
        body["options"] = {"filters": filters}

    return honcho_post(f"/v3/workspaces/{WORKSPACE}/conclusions/list", body)


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

    # Count total messages across all sessions
    total_messages = 0
    for s in session_items:
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
    """Submit an insight about a peer by posting a message to their most recent session."""
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content required")

    # Find most recent session for this peer
    sessions = honcho_post(
        f"/v3/workspaces/{WORKSPACE}/sessions/list",
        {"limit": 50},
    )
    peer_sessions = [
        s for s in sessions.get("items", [])
        if s.get("peer_id") == peerId
    ]
    if not peer_sessions:
        raise HTTPException(status_code=400, detail=f"No sessions found for peer {peerId}")

    # Sort by created_at desc to get most recent
    peer_sessions.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    session_id = peer_sessions[0]["id"]

    # Post message to the session
    msg_result = honcho_post(
        f"/v3/workspaces/{WORKSPACE}/sessions/{session_id}/messages",
        {"messages": [{"content": content, "peer_id": "hermes-owl"}]},
    )

    return {"success": True, "message": msg_result, "session_id": session_id}


@router.get("/source-chat")
async def source_chat(
    session_id: str = Query(...),
    message_id: str | None = None,
    window: int = Query(5, ge=1, le=20),
):
    """Get surrounding messages from Hermes session DB for 'Jump to Chat'."""
    messages = read_hermes_messages(session_id, message_id, window)
    return {"session_id": session_id, "message_id": message_id, "messages": messages}
