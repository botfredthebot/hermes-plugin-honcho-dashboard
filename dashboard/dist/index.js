/**
 * Honcho Dashboard — Hermes Dashboard Plugin
 *
 * Tabs: Overview, Peers, Sessions, Conclusions, Search, Analytics, Status, Config, Import.
 * Features: sidebar nav, full-width list layouts, delete buttons on right,
 *   peer filter dropdown on conclusions, DB status on Status tab.
 */
(function () {
  "use strict";

  try {

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) {
    console.error("[Honcho Dashboard] SDK not available, skipping registration");
    return;
  }

  console.log("[Honcho Dashboard] SDK found, initializing...");

  var React = SDK.React;
  var h = React.createElement;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;

  var API = "/api/plugins/honcho-dashboard";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function fetchJSON(url) {
    var token = window.__HERMES_SESSION_TOKEN__ || "";
    var headers = {};
    if (token) {
      headers["X-Hermes-Session-Token"] = token;
      headers["Authorization"] = "Bearer " + token;
    }
    return fetch(url, { headers: headers }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (body) {
          var parsed;
          try { parsed = JSON.parse(body); } catch (e) {}
          if (parsed && parsed.detail) throw new Error("HTTP " + r.status + ": " + parsed.detail);
          throw new Error("HTTP " + r.status + ": " + body.slice(0, 200));
        });
      }
      return r.text().then(function (body) {
        if (!body || !body.trim()) return {};
        try { return JSON.parse(body); } catch (e) {}
        throw new Error("Invalid JSON response from server");
      });
    });
  }

  function authHeaders() {
    var token = window.__HERMES_SESSION_TOKEN__ || "";
    var headers = { "Content-Type": "application/json" };
    if (token) {
      headers["X-Hermes-Session-Token"] = token;
      headers["Authorization"] = "Bearer " + token;
    }
    return headers;
  }

  function timeAgo(iso) {
    if (!iso) return "unknown";
    var d = new Date(iso);
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function escHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtDate(iso) {
    if (!iso) return "unknown";
    var d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function truncate(str, len) {
    if (!str) return "";
    return str.length > len ? str.slice(0, len) + "…" : str;
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  var S = {
    // Layout
    page: { height: "100%", display: "flex", flexDirection: "column" },
    header: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 24px", borderBottom: "1px solid #30363d",
      background: "#161b22",
    },
    headerTitle: { fontSize: "1.1em", fontWeight: 600, color: "#c9d1d9" },
    tabs: { display: "flex", borderBottom: "1px solid #30363d", padding: "0 24px", gap: 4, background: "#161b22" },
    body: { flex: 1, overflowY: "auto", padding: "24px", background: "#0d1117" },

    // Tab button
    tabBtn: function (active) {
      return {
        padding: "8px 16px", border: "none",
        borderBottom: active ? "2px solid #58a6ff" : "2px solid transparent",
        background: "transparent", color: active ? "#58a6ff" : "#8b949e",
        cursor: "pointer", fontSize: "0.88em", fontWeight: active ? 600 : 400,
      };
    },

    // Full-width row card
    rowCard: {
      background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
      padding: "12px 16px", marginBottom: 8,
    },
    rowCardHighlight: { border: "1px solid #d2992244", background: "#1a1408" },

    // Row layout: left content + right actions
    rowInner: { display: "flex", justifyContent: "space-between", alignItems: "center" },
    rowLeft: { flex: 1, minWidth: 0 },
    rowRight: { display: "flex", gap: 6, alignItems: "center", flexShrink: 0, marginLeft: 12 },

    // Stat cards
    statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 },
    statCard: {
      background: "#161b22", border: "1px solid #30363d", borderRadius: 10,
      padding: "20px", textAlign: "center",
    },
    statNumber: { fontSize: "2em", fontWeight: 700, color: "#58a6ff", marginBottom: 4 },
    statLabel: { fontSize: "0.82em", color: "#8b949e" },

    // Section
    section: { marginBottom: 28 },
    sectionTitle: { fontSize: "1.1em", fontWeight: 600, marginBottom: 12, color: "#c9d1d9" },

    // Text
    mono: { fontFamily: "monospace", fontSize: "0.85em" },
    small: { fontSize: "0.78em", color: "#8b949e" },
    text: { fontSize: "0.88em", lineHeight: 1.5 },
    textSmall: { fontSize: "0.82em", lineHeight: 1.5 },

    // Inputs
    input: {
      padding: "6px 12px", background: "#0d1117", border: "1px solid #30363d",
      borderRadius: 6, color: "#c9d1d9", fontSize: "0.85em", width: "300px",
    },
    textarea: {
      width: "100%", padding: "8px 12px", background: "#0d1117",
      border: "1px solid #30363d", borderRadius: 6, color: "#c9d1d9",
      fontSize: "0.85em", minHeight: "80px", resize: "vertical", boxSizing: "border-box",
    },
    select: {
      padding: "6px 12px", background: "#0d1117", border: "1px solid #30363d",
      borderRadius: 6, color: "#c9d1d9", fontSize: "0.85em", minWidth: "200px",
    },

    // Buttons
    btn: {
      background: "#21262d", border: "1px solid #30363d", borderRadius: 6,
      color: "#c9d1d9", cursor: "pointer", fontSize: "0.82em", padding: "4px 12px",
    },
    btnPrimary: {
      background: "#238636", border: "1px solid #2ea043", borderRadius: 6,
      color: "#fff", cursor: "pointer", fontSize: "0.82em", padding: "6px 14px",
    },
    btnSmall: {
      background: "none", border: "1px solid #30363d", borderRadius: 4,
      color: "#58a6ff", cursor: "pointer", fontSize: "0.75em", padding: "2px 8px",
    },
    btnBack: {
      background: "none", border: "1px solid #30363d", borderRadius: 4,
      color: "#8b949e", cursor: "pointer", fontSize: "0.82em", padding: "4px 10px",
      marginRight: 8,
    },
    btnDelete: {
      background: "none", border: "1px solid #f85149", borderRadius: 4,
      color: "#f85149", cursor: "pointer", fontSize: "0.75em", padding: "2px 8px",
    },
    btnDeleteConfirm: {
      background: "#f85149", border: "1px solid #f85149", borderRadius: 4,
      color: "#fff", cursor: "pointer", fontSize: "0.75em", padding: "2px 8px",
    },

    // Status
    ok: { color: "#3fb950" },
    bad: { color: "#f85149" },
    warn: { color: "#d29922" },

    // Bar chart
    barChart: { display: "flex", alignItems: "flex-end", gap: 4, height: "160px", padding: "10px 0" },
    barCol: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" },
    bar: { width: "100%", background: "#58a6ff", borderRadius: "3px 3px 0 0", minHeight: 4 },
    barSecondary: { background: "#a371f7" },
    barVal: { fontSize: "0.65em", color: "#8b949e", marginTop: 2 },

    // Queue
    queueRow: { marginBottom: 12 },
    queueBarBg: { background: "#21262d", borderRadius: 4, height: 8, width: "100%", marginTop: 4 },
    queueBarFill: { height: "100%", borderRadius: 4 },
    queuePct: { fontSize: "0.75em", color: "#8b949e", marginLeft: 8 },

    // Insight
    insightBox: {
      background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
      padding: "14px 16px", marginBottom: 16,
    },
    insightLabel: { color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.5rem" },

    // DB badge
    dbBadge: {
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 10px", marginBottom: 10, borderRadius: 6,
      fontSize: "0.72em",
    },
  };

  // ---------------------------------------------------------------------------
  // DB Status Badge component
  // ---------------------------------------------------------------------------

  function DbStatusBadge() {
    var _u = useState(null), status = _u[0], setStatus = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];

    function check() {
      setLoading(true);
      fetchJSON(API + "/db-status")
        .then(function (d) { setStatus(d); })
        .catch(function () { setStatus({connected: false, error: "API unreachable"}); })
        .finally(function () { setLoading(false); });
    }

    useEffect(function () { check(); }, []);

    if (loading && !status) {
      return h("div", { style: Object.assign({}, S.dbBadge, { background: "#1c1c1c", border: "1px solid #30363d", color: "#8b949e" }) },
        "⏳ Checking DB…"
      );
    }

    var connected = status && status.connected;
    return h("div", {
      style: Object.assign({}, S.dbBadge, {
        background: connected ? "#0d2b1b" : "#2b0d0d",
        border: "1px solid " + (connected ? "#2ea043" : "#f85149"),
        color: connected ? "#3fb950" : "#f85149",
      }),
    },
      h("span", null, connected ? "🟢" : "🔴"),
      status
        ? (connected
            ? "DB connected — " + status.host + ":" + status.port
            : "DB error — " + (status.error || "unknown"))
        : "Unknown"
    );
  }

  // ---------------------------------------------------------------------------
  // Tab Button
  // ---------------------------------------------------------------------------

  function TabBtn(props) {
    return h("button", {
      onClick: props.onClick,
      style: S.tabBtn(props.active),
    }, (props.icon ? props.icon + " " : "") + props.label);
  }

  // ---------------------------------------------------------------------------
  // Overview Tab
  // ---------------------------------------------------------------------------

  function OverviewTab() {
    var _u = useState(null), data = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];

    useEffect(function () {
      setLoading(true);
      fetchJSON(API + "/overview")
        .then(function (d) { setData(d); setError(null); })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }, []);

    if (loading) return h("div", { style: { padding: 40, color: "#8b949e" } }, "Loading…");
    if (error) return h("div", { style: { padding: 40, color: "#f85149" } }, "⚠️ " + error);
    if (!data) return null;

    return h("div", null,
      h("div", { style: S.statGrid },
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.peers.total)), h("div", { style: S.statLabel }, "Peers")),
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.sessions.total)), h("div", { style: S.statLabel }, "Sessions")),
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.conclusions.total)), h("div", { style: S.statLabel }, "Conclusions")),
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.messages_sampled)), h("div", { style: S.statLabel }, "Messages (sampled)")),
      ),
      h("div", { style: S.section },
        h("div", { style: S.sectionTitle }, "📜 Recent Conclusions"),
        data.conclusions.recent && data.conclusions.recent.length > 0
          ? data.conclusions.recent.map(function (c, i) {
              return h("div", { key: c.id || String(i), style: S.rowCard },
                h("div", { style: S.text }, c.content || ""),
                h("div", { style: S.small },
                  (c.observer_id || "?") + " → " + (c.observed_id || "?") + " · " + timeAgo(c.created_at)
                )
              );
            })
          : h("div", { style: { color: "#8b949e" } }, "Conclusions will appear here as Honcho derives them from conversations.")
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Peers Tab — full-width rows, delete/view on right
  // ---------------------------------------------------------------------------

  function PeersTab() {
    var _u = useState([]), peers = _u[0], setPeers = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), deleteTarget = _u3[0], setDeleteTarget = _u3[1];
    var _u4 = useState(false), deleting = _u4[0], setDeleting = _u4[1];
    var _u5 = useState(false), deleteAllConfirming = _u5[0], setDeleteAllConfirming = _u5[1];
    var _u6 = useState(false), deletingAll = _u6[0], setDeletingAll = _u6[1];

    function loadPeers() {
      setLoading(true);
      fetchJSON(API + "/peers")
        .then(function (d) { setPeers(d.peers || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }

    useEffect(function () { loadPeers(); }, []);

    function confirmDelete() {
      if (!deleteTarget) return;
      var peerId = deleteTarget.id;
      var peerName = deleteTarget.name;
      setDeleting(true);
      fetch(API + "/peer/" + encodeURIComponent(peerId) + "?confirm=true", {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            setDeleteTarget(null);
            loadPeers();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete failed: " + e.message); })
        .finally(function () { setDeleting(false); });
    }

    function handleDeleteAllPeers() {
      if (peers.length === 0) return;
      if (!window.confirm("Delete ALL " + peers.length + " peers and their associated data?\n\nThis will remove: all peers, all messages, documents, collections, and session links. This cannot be undone.")) {
        return;
      }
      setDeletingAll(true);
      fetch(API + "/peers/all?confirm=true", {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            alert("All " + (d.peer_count || 0) + " peers deleted.");
            setDeleteAllConfirming(false);
            loadPeers();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete all failed: " + e.message); })
        .finally(function () { setDeletingAll(false); });
    }

    return h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
        h("div", { style: { fontWeight: 600, fontSize: "0.92em", color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.05em" } },
          "Peers (" + peers.length + ")"
        ),
        peers.length > 0
          ? h("button", { onClick: handleDeleteAllPeers, disabled: deletingAll, style: S.btnDelete },
              deletingAll ? "Deleting…" : "🗑 Delete All (" + peers.length + ")")
          : null
      ),
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Loading…")
        : peers.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No peers found.")
        : peers.map(function (p) {
            var displayName = p.metadata && p.metadata.name ? p.metadata.name : p.id;
            var isDeleteTarget = deleteTarget && deleteTarget.id === p.id;
            return h("div", { key: p.id },
              h("div", { style: S.rowCard },
                h("div", { style: S.rowInner },
                  h("div", { style: S.rowLeft },
                    h("div", { style: { fontWeight: 600, fontSize: "0.95em", marginBottom: 2 } }, displayName),
                    h("div", { style: Object.assign({}, S.small, S.mono) }, p.id),
                    h("div", { style: Object.assign({}, S.small, { marginTop: 4 }) },
                      "Conclusions about: ", h("strong", null, String(p.conclusions_about || 0)),
                      " · By: ", h("strong", null, String(p.conclusions_by || 0))
                    )
                  ),
                  h("div", { style: S.rowRight },
                    h("button", {
                      title: "View details for '" + displayName + "'",
                      onClick: function () { window.open("#", "_self"); },
                      style: S.btnSmall,
                    }, "👁 View"),
                    h("button", {
                      title: "Delete peer '" + displayName + "'",
                      onClick: function (e) {
                        e.stopPropagation();
                        setDeleteTarget({ id: p.id, name: displayName });
                      },
                      style: S.btnDelete,
                    }, "🗑")
                  )
                )
              ),
              isDeleteTarget
                ? h("div", { style: Object.assign({}, S.insightBox, { borderColor: "#f85149", border: "1px solid #f85149", background: "#1a0a0a", marginTop: -4, marginBottom: 8 }) },
                    h("div", { style: { color: "#f85149", fontWeight: 600, marginBottom: 8 } }, "⚠️ Confirm Peer Deletion"),
                    h("div", { style: { marginBottom: 8, fontSize: "0.85em" } },
                      "Delete peer ", h("strong", null, displayName), " and all associated data?",
                      h("div", { style: { color: "#8b949e", marginTop: 4, fontSize: "0.82em" } },
                        "This will remove: the peer, all messages, documents, collections, and session links. This cannot be undone."
                      )
                    ),
                    h("div", { style: { display: "flex", gap: 8 } },
                      h("button", { onClick: confirmDelete, disabled: deleting, style: S.btnDeleteConfirm },
                        deleting ? "Deleting…" : "🗑 Yes, Delete"
                      ),
                      h("button", {
                        onClick: function () { setDeleteTarget(null); },
                        disabled: deleting,
                        style: S.btn,
                      }, "Cancel")
                    )
                  )
                : null
            );
          })
    );
  }

  // ---------------------------------------------------------------------------
  // Sessions Tab — full-width rows, delete/view on right
  // ---------------------------------------------------------------------------

  function SessionsTab() {
    var _u = useState([]), sessions = _u[0], setSessions = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), expanded = _u3[0], setExpanded = _u3[1];
    var _u4 = useState(null), deleteTarget = _u4[0], setDeleteTarget = _u4[1];
    var _u5 = useState(null), deletePreview = _u5[0], setDeletePreview = _u5[1];
    var _u6 = useState(false), deleting = _u6[0], setDeleting = _u6[1];
    var _u7 = useState(false), deletingAll = _u7[0], setDeletingAll = _u7[1];

    function loadSessions() {
      setLoading(true);
      fetchJSON(API + "/sessions")
        .then(function (d) { setSessions(d.sessions || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }

    useEffect(function () { loadSessions(); }, []);

    var emptySessions = sessions.filter(function (s) { return (s.message_count || 0) === 0; });

    function previewDelete(sessionId) {
      fetch(API + "/session/" + encodeURIComponent(sessionId), {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { setDeletePreview(d); setDeleteTarget(sessionId); })
        .catch(function (e) { alert("Error: " + e.message); });
    }

    function confirmDelete() {
      if (!deleteTarget) return;
      setDeleting(true);
      fetch(API + "/session/" + encodeURIComponent(deleteTarget) + "?confirm=true", {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            alert("Session '" + deleteTarget + "' deleted.\n\nRemoved: " +
              (d.deleted.messages || 0) + " messages, " +
              (d.deleted.message_embeddings || 0) + " embeddings, " +
              (d.deleted.session_peers || 0) + " peer links.");
            setDeleteTarget(null);
            setDeletePreview(null);
            loadSessions();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete failed: " + e.message); })
        .finally(function () { setDeleting(false); });
    }

    function deleteAllEmpty() {
      if (emptySessions.length === 0) return;
      if (!window.confirm("Delete " + emptySessions.length + " empty session(s)?\n\nThese sessions have no messages and cannot be recovered.")) {
        return;
      }
      var completed = 0;
      var failed = 0;
      var headers = authHeaders();
      emptySessions.forEach(function (s) {
        fetch(API + "/session/" + encodeURIComponent(s.id) + "?confirm=true", {
          method: "DELETE",
          headers: headers,
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.success) { completed++; } else { failed++; }
          })
          .catch(function () { failed++; })
          .finally(function () {
            if (completed + failed === emptySessions.length) {
              alert("Done.\nDeleted: " + completed + " session(s)" +
                (failed > 0 ? "\nFailed: " + failed : ""));
              loadSessions();
            }
          });
      });
    }

    function handleDeleteAllSessions() {
      if (sessions.length === 0) return;
      if (!window.confirm("Delete ALL " + sessions.length + " sessions and their associated data?\n\nThis will remove: all sessions, all messages, embeddings, and peer links. This cannot be undone.")) {
        return;
      }
      setDeletingAll(true);
      fetch(API + "/sessions/all?confirm=true", {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            alert("All " + (d.session_count || 0) + " sessions deleted.");
            loadSessions();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete all failed: " + e.message); })
        .finally(function () { setDeletingAll(false); });
    }

    return h("div", null,
      // Header
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } },
        h("div", { style: { fontWeight: 600 } },
          "All Sessions (", sessions.length, ")",
          emptySessions.length > 0
            ? h("span", { style: { color: "#d29922", fontSize: "0.82em", marginLeft: 8 } },
                "— ", emptySessions.length, " empty"
              )
            : null
        ),
        h("div", { style: { display: "flex", gap: 8 } },
          sessions.length > 0
            ? h("button", { onClick: handleDeleteAllSessions, disabled: deletingAll, style: S.btnDelete },
                deletingAll ? "Deleting…" : "🗑 Delete All (" + sessions.length + ")")
            : null,
          emptySessions.length > 0
            ? h("button", { onClick: deleteAllEmpty, style: S.btnDelete },
                "🗑 Delete All Empty (" + emptySessions.length + ")")
            : null
        )
      ),

      // Session list
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Loading…")
        : sessions.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No sessions found.")
        : sessions.map(function (s) {
            var msgCount = s.message_count || 0;
            var isEmpty = msgCount === 0;
            var isDeleteTarget = deleteTarget === s.id;
            return h("div", { key: s.id },
              h("div", {
                  style: Object.assign({}, S.rowCard, isEmpty ? S.rowCardHighlight : {}),
                },
                h("div", { style: S.rowInner },
                  h("div", { style: S.rowLeft },
                    h("div", { style: Object.assign({}, S.mono, { fontSize: "0.82em" }) }, s.id),
                    h("div", { style: { fontSize: "0.78em", marginTop: 2 } },
                      h("span", { style: { color: isEmpty ? "#d29922" : "#3fb950" } },
                        msgCount, " ", msgCount === 1 ? "message" : "messages"
                      ),
                      s.is_active ? h("span", { style: { color: "#3fb950", marginLeft: 8 } }, "· Active") : null,
                      isEmpty ? h("span", { style: { color: "#d29922", marginLeft: 8 } }, "· ⚠ Empty") : null
                    ),
                    h("div", { style: S.small }, "Created: ", fmtDate(s.created_at))
                  ),
                  h("div", { style: S.rowRight },
                    h("button", {
                      onClick: function () { setExpanded(expanded === s.id ? null : s.id); },
                      style: S.btnSmall,
                    }, expanded === s.id ? "▾ Hide" : "▸ View"),
                    h("button", {
                      onClick: function () { previewDelete(s.id); },
                      style: S.btnDelete,
                      title: "Delete session"
                    }, "🗑")
                  )
                )
              ),
              isDeleteTarget
                ? h("div", { style: Object.assign({}, S.insightBox, { borderColor: "#f85149", border: "1px solid #f85149", background: "#1a0a0a", marginTop: -4, marginBottom: 8 }) },
                    h("div", { style: { color: "#f85149", fontWeight: 600, marginBottom: 8 } }, "⚠️ Confirm Session Deletion"),
                    deletePreview
                      ? h("div", null,
                          h("div", { style: { marginBottom: 8 } },
                            "About to delete session: ", h("code", null, deletePreview.session_id)
                          ),
                          h("div", { style: { fontSize: "0.82em", color: "#8b949e", marginBottom: 12 } },
                            "This will remove:",
                            h("ul", { style: { margin: "4px 0 0 16px", padding: 0 } },
                              h("li", null, (deletePreview.will_delete.sessions || 0) + " session"),
                              h("li", null, (deletePreview.will_delete.messages || 0) + " messages"),
                              h("li", null, (deletePreview.will_delete.message_embeddings || 0) + " message embeddings"),
                              h("li", null, (deletePreview.will_delete.session_peers || 0) + " session-peer links"),
                              h("li", null, (deletePreview.will_delete.documents || 0) + " documents"),
                            )
                          ),
                          h("div", { style: { display: "flex", gap: 8 } },
                            h("button", { onClick: confirmDelete, disabled: deleting, style: S.btnDeleteConfirm },
                              deleting ? "Deleting…" : "🗑 Yes, Delete"
                            ),
                            h("button", {
                              onClick: function () { setDeleteTarget(null); setDeletePreview(null); },
                              disabled: deleting,
                              style: S.btn,
                            }, "Cancel")
                          )
                        )
                      : h("div", { style: { color: "#8b949e" } }, "Loading preview…")
                  )
                : null,
              expanded === s.id ? h(SessionMessages, { sessionId: s.id }) : null
            );
          })
    );
  }

  function SessionMessages(props) {
    var sessionId = props.sessionId;
    var _u = useState(null), data = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];

    useEffect(function () {
      fetchJSON(API + "/session/" + encodeURIComponent(sessionId) + "/messages?limit=50")
        .then(function (d) { setData(d); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, [sessionId]);

    if (loading) return h("div", { style: { padding: "12px 16px", color: "#8b949e", fontSize: "0.82em" } }, "Loading messages…");
    if (!data) return null;

    var items = data.items || [];
    if (items.length === 0) return h("div", { style: { color: "#8b949e", fontSize: "0.82em", padding: "8px 16px" } }, "No messages.");

    return h("div", { style: { margin: "0 0 12px 16px", borderLeft: "2px solid #30363d", paddingLeft: 12 } },
      items.map(function (m, i) {
        var peer = m.peer_id || m.from || "?";
        var text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return h("div", { key: m.id || String(i), style: { padding: "6px 0", fontSize: "0.82em", borderBottom: "1px solid #21262d" } },
          h("span", { style: { color: "#58a6ff", marginRight: 8 } }, "[" + peer + "]"),
          h("span", { style: { color: "#c9d1d9" } }, truncate(text, 300))
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Conclusions Tab — full-width, delete button per row, peer filter dropdown
  // ---------------------------------------------------------------------------

  function ConclusionsTab() {
    var _u = useState([]), conclusions = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(""), filterPeer = _u3[0], setFilterPeer = _u3[1];
    var _u4 = useState([]), allPeers = _u4[0], setAllPeers = _u4[1];
    var _u5 = useState(null), deleteTarget = _u5[0], setDeleteTarget = _u5[1];
    var _u6 = useState(false), deletingAll = _u6[0], setDeletingAll = _u6[1];

    // Load conclusions (filtered)
    function loadConclusions() {
      setLoading(true);
      var url = API + "/conclusions?limit=5000";
      if (filterPeer) url += "&observed_id=" + encodeURIComponent(filterPeer);
      fetchJSON(url)
        .then(function (d) { setData(d.items || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }

    // Load peer list for dropdown (once)
    function loadPeers() {
      fetchJSON(API + "/peers")
        .then(function (d) { setAllPeers(d.peers || []); })
        .catch(function () {});
    }

    useEffect(function () { loadConclusions(); loadPeers(); }, []);
    useEffect(function () { loadConclusions(); }, [filterPeer]);

    function confirmDelete() {
      if (!deleteTarget) return;
      fetch(API + "/conclusions/" + encodeURIComponent(deleteTarget.id), {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            alert("Conclusion deleted.");
            setDeleteTarget(null);
            loadConclusions();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete failed: " + e.message); });
    }

    function handleDeleteAllConclusions() {
      if (conclusions.length === 0) return;
      if (!window.confirm("Delete ALL " + conclusions.length + " conclusions?\n\nThis cannot be undone.")) {
        return;
      }
      setDeletingAll(true);
      fetch(API + "/conclusions/all?confirm=true", {
        method: "DELETE",
        headers: authHeaders(),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            alert(d.deleted + " conclusions deleted" + (d.errors > 0 ? " (" + d.errors + " errors)" : "") + ".");
            loadConclusions();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete all failed: " + e.message); })
        .finally(function () { setDeletingAll(false); });
    }

    // Build peer options from loaded peers
    var peerOptions = allPeers.map(function (p) {
      var label = p.metadata && p.metadata.name ? p.metadata.name : p.id;
      return { value: p.id, label: label };
    });

    return h("div", null,
      // Filter row
      h("div", { style: { marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
        h("select", {
          style: S.select,
          value: filterPeer,
          onChange: function (e) { setFilterPeer(e.target.value); },
        },
          h("option", { value: "" }, "All Peers"),
          peerOptions.map(function (opt) {
            return h("option", { key: opt.value, value: opt.value }, opt.label);
          })
        ),
        filterPeer ? h("button", { onClick: function () { setFilterPeer(""); }, style: S.btn }, "✕ Clear") : null,
        conclusions.length > 0
          ? h("button", { onClick: handleDeleteAllConclusions, disabled: deletingAll, style: S.btnDelete },
              deletingAll ? "Deleting…" : "🗑 Delete All (" + conclusions.length + ")")
          : null
      ),

      // Conclusions list
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Loading…")
        : conclusions.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No conclusions found.")
        : conclusions.map(function (c, i) {
            var isDeleteTarget = deleteTarget && deleteTarget.id === c.id;
            return h("div", { key: c.id || String(i) },
              h("div", { style: S.rowCard },
                h("div", { style: S.rowInner },
                  h("div", { style: S.rowLeft },
                    h("div", { style: { fontSize: "0.88em", lineHeight: 1.5, marginBottom: 6 } }, c.content || ""),
                    h("div", { style: { fontSize: "0.75em", color: "#8b949e" } },
                      (c.observer_id || "?") + " → " + (c.observed_id || "?") + " · " + timeAgo(c.created_at)
                    )
                  ),
                  h("div", { style: S.rowRight },
                    h("button", {
                      onClick: function () { setDeleteTarget(c); },
                      style: S.btnDelete,
                      title: "Delete this conclusion"
                    }, "🗑")
                  )
                )
              ),
              isDeleteTarget
                ? h("div", { style: Object.assign({}, S.insightBox, { borderColor: "#f85149", border: "1px solid #f85149", background: "#1a0a0a", marginTop: -4, marginBottom: 8 }) },
                    h("div", { style: { color: "#f85149", fontWeight: 600, marginBottom: 8 } }, "⚠️ Confirm Deletion"),
                    h("div", { style: { marginBottom: 8, fontSize: "0.85em" } },
                      "Delete this conclusion?",
                      h("div", { style: { color: "#8b949e", marginTop: 4 } },
                        truncate(c.content || "", 200)
                      )
                    ),
                    h("div", { style: { display: "flex", gap: 8 } },
                      h("button", { onClick: confirmDelete, style: S.btnDeleteConfirm }, "🗑 Yes, Delete"),
                      h("button", {
                        onClick: function () { setDeleteTarget(null); },
                        style: S.btn,
                      }, "Cancel")
                    )
                  )
                : null
            );
          })
    );
  }

  // ---------------------------------------------------------------------------
  // Search Tab
  // ---------------------------------------------------------------------------

  function SearchTab() {
    var _u = useState(""), query = _u[0], setQuery = _u[1];
    var _u2 = useState(null), results = _u2[0], setResults = _u2[1];
    var _u3 = useState(false), loading = _u3[0], setLoading = _u3[1];
    var _u4 = useState(null), error = _u4[0], setError = _u4[1];

    function doSearch() {
      if (!query.trim()) return;
      setLoading(true);
      setError(null);
      fetchJSON(API + "/search?q=" + encodeURIComponent(query) + "&limit=20")
        .then(function (d) { setResults(d); })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }

    var items = results ? (results.items || results || []) : [];
    if (results && results.error) error = results.error;
    if (results && results.detail) error = results.detail;

    return h("div", null,
      h("div", { style: { marginBottom: 16, display: "flex", gap: 8 } },
        h("input", {
          style: Object.assign({}, S.input, { width: "400px" }),
          placeholder: "Search messages across all peers…",
          value: query,
          onChange: function (e) { setQuery(e.target.value); },
          onKeyPress: function (e) { if (e.key === "Enter") doSearch(); },
        }),
        h("button", { onClick: doSearch, style: S.btnPrimary }, "Search")
      ),
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Searching…")
        : error
        ? h("div", { style: { color: "#f85149", padding: 20 } }, "⚠️ ", error)
        : results && items.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No results found.")
        : results
        ? h("div", null,
            h("div", { style: { marginBottom: 12, color: "#8b949e", fontSize: "0.82em" } }, items.length, " results for \"", query, "\""),
            items.map(function (r, i) {
              var content = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
              return h("div", { key: String(i), style: S.rowCard },
                h("div", { style: { marginBottom: 4 } },
                  h("span", { style: { color: "#58a6ff", fontSize: "0.78em", marginRight: 8 } },
                    r.session_id ? "[" + truncate(r.session_id, 40) + "]" : ""
                  ),
                  r.peer_id ? h("span", { style: { color: "#a371f7", fontSize: "0.78em" } }, r.peer_id) : null
                ),
                h("div", { style: S.textSmall }, truncate(content, 300))
              );
            })
          )
        : h("div", { style: { color: "#8b949e", padding: 40 } }, "Enter a search query to find messages across all sessions.")
    );
  }

  // ---------------------------------------------------------------------------
  // Analytics Tab
  // ---------------------------------------------------------------------------

  function AnalyticsTab() {
    var _u = useState(null), data = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];

    useEffect(function () {
      setLoading(true);
      fetchJSON(API + "/analytics")
        .then(function (d) { setData(d); setError(null); })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }, []);

    if (loading) return h("div", { style: { padding: 40, color: "#8b949e" } }, "Loading analytics…");
    if (error) return h("div", { style: { padding: 40, color: "#f85149" } }, "⚠️ " + error);
    if (!data) return null;

    var days = data.days || [];
    var msgByDay = data.messages_by_day || {};
    var concByDay = data.conclusions_by_day || {};
    var maxMsgs = Math.max.apply(null, days.map(function (d) { return msgByDay[d] || 0; }).concat([1]));
    var maxConcs = Math.max.apply(null, days.map(function (d) { return concByDay[d] || 0; }).concat([1]));

    function dayLabel(d) {
      var dt = new Date(d + "T00:00:00");
      return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    }

    return h("div", null,
      h("h2", { style: { marginBottom: 16 } }, "Analytics (last 14 days)"),
      h("div", { style: S.statGrid },
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.total_sessions)), h("div", { style: S.statLabel }, "Total Sessions")),
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.total_messages)), h("div", { style: S.statLabel }, "Total Messages")),
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.total_conclusions)), h("div", { style: S.statLabel }, "Total Conclusions")),
        h("div", { style: S.statCard }, h("div", { style: S.statNumber }, String(data.total_peers)), h("div", { style: S.statLabel }, "Peers")),
      ),
      h("div", { style: S.rowCard },
        h("h3", { style: { marginBottom: 8 } }, "📨 Messages per Day"),
        h("div", { style: S.barChart },
          days.map(function (d) {
            var count = msgByDay[d] || 0;
            var barH = Math.round((count / maxMsgs) * 120);
            return h("div", { key: d, style: S.barCol },
              h("div", { style: Object.assign({}, S.bar, { height: barH + "px" }), title: count + " messages on " + d }),
              h("small", null, dayLabel(d)),
              h("small", { style: S.barVal }, String(count))
            );
          })
        )
      ),
      h("div", { style: Object.assign({}, S.rowCard, { marginTop: 16 }) },
        h("h3", { style: { marginBottom: 8 } }, "🧠 Conclusions per Day"),
        h("div", { style: S.barChart },
          days.map(function (d) {
            var count = concByDay[d] || 0;
            var barH = Math.round((count / maxConcs) * 120);
            return h("div", { key: d, style: S.barCol },
              h("div", { style: Object.assign({}, S.bar, S.barSecondary, { height: barH + "px" }), title: count + " conclusions on " + d }),
              h("small", null, dayLabel(d)),
              h("small", { style: S.barVal }, String(count))
            );
          })
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Dreams Tab — dream queue, per-pair health, history, manual trigger
  // ---------------------------------------------------------------------------

  function DreamsTab() {
    var _u = useState(null), data = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];
    var _u4 = useState(null), config = _u4[0], setConfig = _u4[1];
    var _u5 = useState(false), scheduling = _u5[0], setScheduling = _u5[1];
    var _u6 = useState(""), scheduleObserver = _u6[0], setScheduleObserver = _u6[1];
    var _u7 = useState(""), scheduleObserved = _u7[0], setScheduleObserved = _u7[1];
    var _u8 = useState(null), history = _u8[0], setHistory = _u8[1];
    var _u9 = useState(false), loadingHistory = _u9[0], setLoadingHistory = _u9[1];

    useEffect(function () {
      setLoading(true);
      setLoadingHistory(true);
      Promise.all([
        fetchJSON(API + "/dreams/status"),
        fetchJSON(API + "/dreams/config"),
        fetchJSON(API + "/dreams/history?limit=20"),
      ]).then(function (results) {
        setData(results[0]);
        setConfig(results[1]);
        setHistory(results[2]);
        setError(null);
      }).catch(function (e) {
        setError(e.message);
      }).finally(function () {
        setLoading(false);
        setLoadingHistory(false);
      });
    }, []);

    // If dreams are disabled, show disabled message
    if (config && config.ENABLED === false) {
      return h("div", null,
        h("h2", { style: { marginBottom: 16 } }, "Dreams"),
        h("div", { style: {
          padding: "24px",
          background: "#1c1f26",
          borderRadius: 8,
          border: "1px solid #30363d",
          textAlign: "center",
          color: "#8b949e",
        }},
          h("div", { style: { fontSize: "2rem", marginBottom: 12 } }, "💤"),
          h("div", { style: { fontSize: "1rem", fontWeight: 600, marginBottom: 8 } }, "Dreams are disabled"),
          h("div", { style: { fontSize: "0.85rem" } },
            "Enable dreams in the Honcho configuration to allow memory consolidation."),
          h("div", { style: { fontSize: "0.8rem", marginTop: 8 } },
            "Config location: settings.DREAM.ENABLED or DREAM_ENABLED env var"),
        )
      );
    }

    var queue = (data && data.queue) || {};
    var dreamItems = (data && data.dream_queue_items) || [];
    var pairHealth = (data && data.pair_health) || [];
    var historyItems = (history && history.items) || [];

    // Separate pending and in-progress
    var activeDreams = dreamItems.filter(function (d) { return !d.processed; });
    var completedRecent = dreamItems.filter(function (d) { return d.processed; }).slice(0, 5);

    return h("div", null,
      h("h2", { style: { marginBottom: 16 } }, "Dreams"),

      // --- Disabled banner (config read-only) ---
      h("div", { style: {
        padding: "10px 14px",
        background: "#1c1f26",
        borderRadius: 6,
        border: "1px solid #30363d",
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
      }},
        h("span", { style: { fontSize: "0.8rem", color: "#8b949e" } },
          "Threshold: ", h("strong", { style: { color: "#e6edf3" } }, (config && config.DOCUMENT_THRESHOLD) || "?"),
          " docs · Min interval: ", h("strong", { style: { color: "#e6edf3" } }, (config && config.MIN_HOURS_BETWEEN_DREAMS) || "?", "h"),
          " · Idle timeout: ", h("strong", { style: { color: "#e6edf3" } }, (config && config.IDLE_TIMEOUT_MINUTES) || "?", "m"),
          " · Types: ", h("strong", { style: { color: "#e6edf3" } }, ((config && config.ENABLED_TYPES) || []).join(", ")),
        ),
        h("span", { style: { fontSize: "0.7rem", color: "#6e7681" } }, "Read-only — edit in Config tab"),
      ),

      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }},
        h("div", { style: S.statCard },
          h("div", { style: Object.assign({}, S.statNumber, (queue.active || 0) > 0 ? { color: "#d29922" } : S.ok) }, String(queue.active || 0)),
          h("div", { style: S.statLabel }, "Active Dream Tasks"),
        ),
        h("div", { style: S.statCard },
          h("div", { style: Object.assign({}, S.statNumber, S.ok) }, String(queue.completed || 0)),
          h("div", { style: S.statLabel }, "Completed"),
        ),
      ),

      // --- Active Queue ---
      h("h3", { style: { marginBottom: 12, fontSize: "1rem" } }, "Queue"),
      h("div", { style: { marginBottom: 24 } },
        activeDreams.length === 0
          ? h("p", { style: { color: "#6e7681", fontSize: "0.85rem" } }, "No pending dream tasks.")
          : h("table", { style: { width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" } },
            h("thead", null,
              h("tr", { style: { borderBottom: "1px solid #30363d" } },
                h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Peer Pair"),
                h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Type"),
                h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Trigger"),
                h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Docs"),
                h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Queued"),
              )
            ),
            h("tbody", null,
              activeDreams.map(function (d, i) {
                var pairLabel = d.observer ? (d.observer + (d.observed && d.observed !== d.observer ? " → " + d.observed : "")) : "unknown";
                return h("tr", { key: d.id || i, style: { borderBottom: "1px solid #21262d" } },
                  h("td", { style: { padding: "6px 8px", color: "#8b949e" } }, h("span", { style: { color: "#e6edf3" } }, pairLabel)),
                  h("td", { style: { padding: "6px 8px", color: "#8b949e" } }, h("span", { style: { color: "#8b949e" } }, d.dream_type || "omni")),
                  h("td", { style: { padding: "6px 8px", color: "#8b949e" } }, h("span", { style: { color: d.trigger_reason === "manual" ? "#d29922" : "#8b949e" } }, d.trigger_reason || "-")),
                  h("td", { style: { padding: "6px 8px", color: "#8b949e" } },
                    d.documents_since_last_dream != null && d.document_threshold
                      ? h("span", null, d.documents_since_last_dream, "/", d.document_threshold)
                      : h("span", { style: { color: "#6e7681" } }, "-")
                  ),
                  h("td", { style: { padding: "6px 8px", color: "#8b949e" } }, h("span", { style: { color: "#6e7681" } }, d.created_at ? new Date(d.created_at).toLocaleString("en-GB") : "-")),
                );
              })
            )
          )
      ),

      // --- Per-Pair Dream Health ---
      h("h3", { style: { marginBottom: 12, fontSize: "1rem" } }, "Dream Health by Pair"),
      h("div", { style: { marginBottom: 24 } },
        loading
          ? h("p", { style: { color: "#6e7681", fontSize: "0.85rem" } }, "Loading...")
          : pairHealth.length === 0
            ? h("p", { style: { color: "#6e7681", fontSize: "0.85rem" } }, "No peer pairs found.")
            : h("table", { style: { width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" } },
              h("thead", null,
                h("tr", { style: { borderBottom: "1px solid #30363d" } },
                  h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Peer Pair"),
                  h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Last Dream"),
                  h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Docs Since"),
                  h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Progress"),
                  h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Pending"),
                  h("th", { style: { textAlign: "left", padding: "6px 8px", color: "#8b949e", fontWeight: 600, fontSize: "0.75rem" } }, "Action"),
                )
              ),
              h("tbody", null,
                pairHealth.map(function (p, i) {
                  var threshold = (config && config.DOCUMENT_THRESHOLD) || 50;
                  var pct = Math.min(100, Math.round((p.documents_since_last_dream / threshold) * 100));
                  var barColor = pct >= 100 ? "#238636" : pct >= 70 ? "#d29922" : "#30363d";
                  var pairLabel = p.observer + (p.observed !== p.observer ? " → " + p.observed : "");
                  var lastDreamStr = p.last_dream_at
                    ? new Date(p.last_dream_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                    : "Never";
                  return h("tr", { key: i, style: { borderBottom: "1px solid #21262d" } },
                    h("td", { style: { padding: "6px 8px", color: "#8b949e" }, style: Object.assign({}, { padding: "6px 8px", color: "#8b949e" }, { fontWeight: 600, color: "#e6edf3" }) }, pairLabel),
                    h("td", { style: { padding: "6px 8px", color: "#8b949e" } }, h("span", { style: { color: "#8b949e" } }, lastDreamStr)),
                    h("td", { style: { padding: "6px 8px", color: "#8b949e" } },
                      h("span", { style: { color: p.documents_since_last_dream > 0 ? "#e6edf3" : "#6e7681" } },
                        p.documents_since_last_dream || 0)
                    ),
                    h("td", { style: { padding: "6px 8px", color: "#8b949e" } },
                      h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                        h("div", { style: { width: 60, height: 6, background: "#21262d", borderRadius: 3, overflow: "hidden" } },
                          h("div", { style: { width: pct + "%", height: "100%", background: barColor, borderRadius: 3 } })
                        ),
                        h("span", { style: { color: "#6e7681", fontSize: "0.7rem" } }, pct, "%")
                      )
                    ),
                    h("td", { style: { padding: "6px 8px", color: "#8b949e" } },
                      p.has_pending_dream
                        ? h("span", { style: { color: "#d29922", fontSize: "0.75rem" } }, "⏳ queued")
                        : h("span", { style: { color: "#6e7681" } }, "—")
                    ),
                    h("td", { style: { padding: "6px 8px", color: "#8b949e" } },
                      h("button", {
                        disabled: scheduling || p.has_pending_dream,
                        onClick: function () {
                          if (!window.confirm("Schedule dream for " + pairLabel + "?\n\nThis will trigger a memory consolidation cycle for this peer pair.")) return;
                          setScheduling(true);
                          fetch(API + "/dreams/schedule", {
                            method: "POST",
                            headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
                            body: JSON.stringify({ observer: p.observer, observed: p.observed }),
                          }).then(function (r) { return r.json(); })
                            .then(function (d) {
                              alert("✓ " + (d.message || "Dream scheduled"));
                              // Refresh status
                              fetchJSON(API + "/dreams/status").then(setData).catch(function () {});
                            })
                            .catch(function (e) { alert("Error: " + e.message); })
                            .finally(function () { setScheduling(false); });
                        },
                        style: {
                          padding: "3px 8px",
                          fontSize: "0.7rem",
                          background: p.has_pending_dream ? "#30363d" : "#238636",
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          cursor: p.has_pending_dream || scheduling ? "not-allowed" : "pointer",
                          opacity: p.has_pending_dream ? 0.5 : 1,
                        }
                      }, scheduling ? "⏳" : "💤")
                    ),
                  );
                })
              )
            )
      ),

      // --- Dream History ---
      h("h3", { style: { marginBottom: 12, fontSize: "1rem" } }, "Dream History"),
      h("div", null,
        loadingHistory
          ? h("p", { style: { color: "#6e7681", fontSize: "0.85rem" } }, "Loading...")
          : historyItems.length === 0
            ? h("p", { style: { color: "#6e7681", fontSize: "0.85rem" } }, "No dream history yet.")
            : historyItems.map(function (h_item, i) {
              var pairLabel = h_item.observer + (h_item.observed !== h_item.observer ? " → " + h_item.observed : "");
              var completedStr = h_item.completed_at ? new Date(h_item.completed_at).toLocaleString("en-GB") : "unknown";
              return h("div", { key: h_item.id || i, style: {
                padding: "10px 12px",
                background: "#0d1117",
                borderRadius: 6,
                border: "1px solid #30363d",
                marginBottom: 8,
              }},
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
                  h("span", { style: { fontWeight: 600, fontSize: "0.8rem", color: "#e6edf3" } }, pairLabel),
                  h("span", { style: { fontSize: "0.7rem", color: "#6e7681" } }, completedStr),
                ),
                h("div", { style: { display: "flex", gap: 12, fontSize: "0.75rem", color: "#8b949e" } },
                  h("span", null, "Type: ", h("strong", null, h_item.dream_type || "omni")),
                  h("span", null, "Trigger: ", h("strong", null, h_item.trigger_reason || "-")),
                  h("span", null, "Conclusions: ", h("strong", { style: { color: h_item.conclusions_count > 0 ? "#3fb950" : "#6e7681" } }, h_item.conclusions_count || 0)),
                  h_item.error ? h("span", { style: { color: "#f85149" } }, "Error: " + h_item.error) : null,
                ),
                h_item.conclusions_sample && h_item.conclusions_sample.length > 0
                  ? h("div", { style: { marginTop: 6, paddingTop: 6, borderTop: "1px solid #21262d" } },
                      h("div", { style: { fontSize: "0.7rem", color: "#6e7681", marginBottom: 4 } }, "Sample conclusions:"),
                      h_item.conclusions_sample.slice(0, 3).map(function (c, ci) {
                        return h("div", { key: ci, style: {
                          fontSize: "0.7rem",
                          color: "#8b949e",
                          padding: "2px 0",
                          borderLeft: "2px solid " + (c.level === "deductive" ? "#58a6ff" : c.level === "inductive" ? "#3fb950" : "#d29922"),
                          paddingLeft: 6,
                          marginBottom: 2,
                        } },
                          h("span", { style: { color: "#6e7681" } }, "[", c.level, "] "),
                          c.content
                        );
                      })
                    )
                  : null
              );
            })
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Status Tab — includes DB status badge
  // ---------------------------------------------------------------------------

  function StatusTab() {
    var _u = useState(null), data = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];
    var _u4 = useState(false), updating = _u4[0], setUpdating = _u4[1];
    var _u5 = useState(null), versionCheck = _u5[0], setVersionCheck = _u5[1];
    var _u6 = useState(false), checking = _u6[0], setChecking = _u6[1];

    useEffect(function () {
      setLoading(true);
      fetchJSON(API + "/status")
        .then(function (d) { setData(d); setError(null); })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }, []);

    if (loading) return h("div", { style: { padding: 40, color: "#8b949e" } }, "Loading status…");
    if (error) return h("div", { style: { padding: 40, color: "#f85149" } }, "⚠️ " + error);
    if (!data) return null;

    var q = data.queue || {};
    var sessionsQ = q.sessions || {};
    var sessionEntries = [];
    for (var sid in sessionsQ) { sessionEntries.push(sessionsQ[sid]); }
    var activeWU = q.active || 0;

    return h("div", null,
      h("h2", { style: { marginBottom: 16 } }, "System Status"),

      // DB Status badge at top of Status tab
      h(DbStatusBadge),

      // Version + Update
      h("div", { style: { marginBottom: 16 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } },
          h("div", { style: { fontSize: "0.85rem", color: "#8b949e" } },
            "Version: ", h("strong", { style: { color: "#e6edf3" } }, data.honcho_version || "unknown")
          ),
          versionCheck && versionCheck.update_available === true
            ? h("span", { style: { fontSize: "0.75rem", color: "#d29922", background: "#3b2300", padding: "2px 8px", borderRadius: 4 } },
                "⬆ " + (versionCheck.latest || "update available")
              )
            : null,
          versionCheck && versionCheck.update_available === false
            ? h("span", { style: { fontSize: "0.75rem", color: "#3fb950" } }, "✓ Up to date")
            : null
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          versionCheck && versionCheck.update_available === true
            ? h("button",
                {
                  disabled: updating,
                  onClick: function () {
                    if (!window.confirm("Update Honcho to v" + (versionCheck.latest || "latest") + "?\n\nThis will:\n1. Pull the latest Docker image\n2. Restart the Honcho API container\n\nIt will be unavailable for a few seconds.")) return;
                    setUpdating(true);
                    fetch(API + "/update", { method: "POST", headers: authHeaders() })
                      .then(function (r) { return r.json(); })
                      .then(function (d) {
                        if (d.success) {
                          alert(d.message || "Update triggered.");
                          setVersionCheck(null);
                          setTimeout(function () { setLoading(true); fetchJSON(API + "/status").then(function (d2) { setData(d2); setError(null); }).catch(function (e) { setError(e.message); }).finally(function () { setLoading(false); }); }, 5000);
                        } else {
                          alert("Error: " + (d.detail || "Unknown error"));
                        }
                      })
                      .catch(function (e) { alert("Update failed: " + e.message); })
                      .finally(function () { setUpdating(false); });
                  },
                  style: { padding: "6px 14px", fontSize: "0.8rem", background: "#d29922", color: "#fff", border: "none", borderRadius: 6, cursor: updating ? "not-allowed" : "pointer", opacity: updating ? 0.6 : 1 }
                },
                updating ? "⏳ Updating…" : "⬆ Update Now"
              )
            : h("button",
                {
                  disabled: checking,
                  onClick: function () {
                    setChecking(true);
                    setVersionCheck(null);
                    fetchJSON(API + "/version-check")
                      .then(function (vc) {
                        setVersionCheck(vc);
                        if (vc.update_available === false) {
                          // Already up to date — no need for update button
                        } else if (vc.update_available === null) {
                          alert("Could not check for updates: " + (vc.message || "Registry may be unavailable"));
                        }
                      })
                      .catch(function (e) { alert("Version check failed: " + e.message); })
                      .finally(function () { setChecking(false); });
                  },
                  style: { padding: "6px 14px", fontSize: "0.8rem", background: "#238636", color: "#fff", border: "none", borderRadius: 6, cursor: checking ? "not-allowed" : "pointer", opacity: checking ? 0.6 : 1 }
                },
                checking ? "⏳ Checking…" : "🔍 Check for Update"
              )
        ),
        versionCheck && versionCheck.update_available === true
          ? h("div", { style: { fontSize: "0.75rem", color: "#d29922", marginTop: 6 } },
              "Update available: v" + (versionCheck.installed || "?") + " → v" + (versionCheck.latest || "?")
            )
          : null
      ),

      h("div", { style: S.statGrid },
        h("div", { style: S.statCard },
          h("div", { style: Object.assign({}, S.statNumber, data.honcho_reachable ? S.ok : S.bad) },
            data.honcho_reachable ? "✓" : "✗"
          ),
          h("div", { style: S.statLabel }, "Honcho API")
        ),
        h("div", { style: S.statCard },
          h("div", { style: S.statNumber }, String(q.total || 0)),
          h("div", { style: S.statLabel }, "Total Work Units")
        ),
        h("div", { style: S.statCard },
          h("div", { style: Object.assign({}, S.statNumber, S.ok) }, String(q.completed || 0)),
          h("div", { style: S.statLabel }, "Completed")
        ),
        h("div", { style: S.statCard },
          h("div", { style: Object.assign({}, S.statNumber, activeWU > 0 ? S.warn : S.ok) }, String(activeWU)),
          h("div", { style: S.statLabel }, "Pending / In Progress")
        )
      ),

      h("div", { style: Object.assign({}, S.rowCard, { marginTop: 16 }) },
        h("h3", { style: { marginBottom: 8 } }, "⚡ Queue / Backlog"),
        activeWU > 0
          ? h("div", { style: Object.assign({}, S.warn, { fontSize: "0.85rem", marginBottom: 12 }) },
              "⚡ ", activeWU, " work unit", activeWU > 1 ? "s" : "", " being processed by Honcho"
            )
          : h("div", { style: Object.assign({}, S.ok, { fontSize: "0.85rem", marginBottom: 12 }) }, "All work units completed"),
        sessionEntries.length === 0
          ? h("div", { style: { color: "#64748B", fontSize: "0.85rem" } }, "No sessions with queue activity.")
          : sessionEntries.map(function (s) {
              var total = s.total_work_units || 0;
              var done = s.completed_work_units || 0;
              var pend = s.pending_work_units || 0;
              var inProg = s.in_progress_work_units || 0;
              var active = pend + inProg;
              var pct = total > 0 ? Math.round((done / total) * 100) : 100;
              return h("div", { key: s.session_id || Math.random(), style: S.queueRow },
                h("div", { style: { display: "flex", justifyContent: "space-between" } },
                  h("span", { style: S.mono }, truncate(s.session_id || "unknown", 40)),
                  h("span", { style: S.queuePct }, done, "/", total, " (", pct, "%)")
                ),
                h("div", { style: S.queueBarBg },
                  h("div", { style: Object.assign({}, S.queueBarFill, {
                    width: pct + "%",
                    background: pct === 100 ? "#3fb950" : active > 0 ? "#d29922" : "#58a6ff",
                  }) })
                )
              );
            })
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Config Tab — editable global settings + workspace overrides
  // ---------------------------------------------------------------------------

  function ConfigTab() {
    var _u = useState(null), config = _u[0], setConfig = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];
    var _u4 = useState(false), saving = _u4[0], setSaving = _u4[1];
    var _u5 = useState(null), saveMsg = _u5[0], setSaveMsg = _u5[1];
    var _u6 = useState(null), globalConfig = _u6[0], setGlobalConfig = _u6[1];
    var _u7 = useState(true), globalLoading = _u7[0], setGlobalLoading = _u7[1];
    var _u8 = useState(false), globalSaving = _u8[0], setGlobalSaving = _u8[1];
    var _u9 = useState(null), globalSaveMsg = _u9[0], setGlobalSaveMsg = _u9[1];
    var _u10 = useState({}), editedGlobal = _u10[0], setEditedGlobal = _u10[1];

    function loadConfig() {
      setLoading(true); setError(null);
      fetchJSON(API + "/config")
        .then(function (d) { setConfig(d); })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }

    function loadGlobalConfig() {
      setGlobalLoading(true);
      fetchJSON(API + "/global-config")
        .then(function (d) { setGlobalConfig(d); setEditedGlobal({}); })
        .catch(function () { /* best-effort */ })
        .finally(function () { setGlobalLoading(false); });
    }

    useEffect(function () { loadConfig(); loadGlobalConfig(); }, []);

    function getNested(obj, path) {
      if (!obj) return undefined;
      var parts = path.split("."), cur = obj;
      for (var i = 0; i < parts.length; i++) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = cur[parts[i]];
      }
      return cur;
    }

    function getGlobalValue(path) {
      if (editedGlobal[path] !== undefined) return editedGlobal[path];
      return getNested(globalConfig, path);
    }

    function getEffective(wsPath, globalPath) {
      var wsVal = getNested(config && config.configuration, wsPath);
      if (wsVal !== undefined && wsVal !== null) return wsVal;
      return getGlobalValue(globalPath);
    }

    function isOverridden(wsPath) {
      var wsVal = getNested(config && config.configuration, wsPath);
      return wsVal !== undefined && wsVal !== null;
    }

    function updateEditedGlobal(path, value) {
      var next = Object.assign({}, editedGlobal);
      next[path] = value;
      setEditedGlobal(next);
    }

    function updateWorkspaceField(path, value) {
      var newConfig = JSON.parse(JSON.stringify(config || {}));
      var parts = path.split("."), obj = newConfig.configuration || (newConfig.configuration = {});
      for (var i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      setConfig(newConfig);
    }

    function handleSaveWorkspace() {
      if (!config) return;
      setSaving(true); setSaveMsg(null);
      fetch(API + "/config", {
        method: "PUT",
        headers: Object.assign({}, authHeaders(), {"Content-Type": "application/json"}),
        body: JSON.stringify({ configuration: config.configuration || {} }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) { setSaveMsg({ type: "ok", text: "Workspace config saved." }); loadConfig(); }
          else { setSaveMsg({ type: "err", text: (d.detail || "Save failed") }); }
        })
        .catch(function (e) { setSaveMsg({ type: "err", text: e.message }); })
        .finally(function () { setSaving(false); });
    }

    function handleSaveGlobal() {
      if (Object.keys(editedGlobal).length === 0) {
        setGlobalSaveMsg({ type: "err", text: "No changes to save." });
        return;
      }
      setGlobalSaving(true); setGlobalSaveMsg(null);
      fetch(API + "/global-config", {
        method: "PUT",
        headers: Object.assign({}, authHeaders(), {"Content-Type": "application/json"}),
        body: JSON.stringify(editedGlobal),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            setGlobalSaveMsg({ type: "ok", text: "Global config saved. Service restarting…" });
            setEditedGlobal({});
            setTimeout(function () { loadGlobalConfig(); }, 3000);
          } else { setGlobalSaveMsg({ type: "err", text: (d.detail || "Save failed") }); }
        })
        .catch(function (e) { setGlobalSaveMsg({ type: "err", text: e.message }); })
        .finally(function () { setGlobalSaving(false); });
    }

    function renderToggle(label, path, isWorkspace, description) {
      var isOn, isGreyed, badge, titleText, onClick;
      if (isWorkspace) {
        var effective = getEffective(path, path);
        isOn = effective === true;
        var overridden = isOverridden(path);
        var gVal = getGlobalValue(path);
        isGreyed = !overridden && gVal != null;
        badge = isGreyed
          ? h("span", { style: { fontSize: "0.7em", color: "#8b949e", marginLeft: 6, fontWeight: 400 } }, "— global")
          : overridden
          ? h("span", { style: { fontSize: "0.7em", color: "#d29922", marginLeft: 6, fontWeight: 400 } }, "— overridden")
          : null;
        titleText = isGreyed ? "Global: " + (isOn ? "ON" : "OFF") + ". Click to override." : (isOn ? "ON" : "OFF") + " — click to toggle";
        onClick = function () { updateWorkspaceField(path, !isOn); };
      } else {
        isOn = getGlobalValue(path) === true;
        isGreyed = false; badge = null;
        titleText = (isOn ? "ON" : "OFF") + " — click to toggle";
        onClick = function () { updateEditedGlobal(path, !isOn); };
      }
      return h("div", { style: { marginBottom: 14, opacity: isGreyed ? 0.5 : 1 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("div", null,
            h("div", { style: { fontWeight: 600, fontSize: "0.88em" } }, label, badge),
            description ? h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginTop: 2 } }, description) : null
          ),
          h("button", { onClick: onClick, title: titleText,
            style: { width: 48, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
              background: isOn ? "#238636" : "#30363d", position: "relative", padding: 0, transition: "background 0.2s" },
          },
            h("div", { style: { width: 20, height: 20, borderRadius: 10, background: "#fff", position: "absolute", top: 3, left: isOn ? 25 : 3, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" } })
          )
        )
      );
    }

    function renderNumber(label, path, isWorkspace, description, min, max) {
      var val, onChange, isGreyed, badge;
      if (isWorkspace) {
        var wsVal = getNested(config && config.configuration, path);
        var gVal = getGlobalValue(path);
        var overridden = isOverridden(path);
        isGreyed = !overridden && gVal != null;
        val = (wsVal != null) ? wsVal : (gVal != null ? gVal : "");
        onChange = function (e) { var v = parseInt(e.target.value, 10); if (!isNaN(v)) updateWorkspaceField(path, v); };
        badge = isGreyed ? h("span", { style: { fontSize: "0.7em", color: "#8b949e", marginLeft: 6, fontWeight: 400 } }, "— global") : null;
      } else {
        val = getGlobalValue(path); val = (val != null) ? val : "";
        onChange = function (e) { var v = parseInt(e.target.value, 10); if (!isNaN(v)) updateEditedGlobal(path, v); };
        isGreyed = false; badge = null;
      }
      return h("div", { style: { marginBottom: 14, opacity: isGreyed ? 0.5 : 1 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("div", null,
            h("div", { style: { fontWeight: 600, fontSize: "0.88em" } }, label, badge),
            description ? h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginTop: 2 } }, description) : null
          ),
          h("input", { type: "number", min: min, max: max, value: val, onChange: onChange,
            style: Object.assign({}, S.input, { width: "100px", textAlign: "center" }),
          })
        )
      );
    }

    function renderTextarea(label, path, description) {
      var val = getNested(config && config.configuration, path) || "";
      return h("div", { style: { marginBottom: 14 } },
        h("div", { style: { fontWeight: 600, fontSize: "0.88em", marginBottom: 4 } }, label),
        description ? h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginBottom: 6 } }, description) : null,
        h("textarea", { value: val, onChange: function (e) { updateWorkspaceField(path, e.target.value); }, placeholder: "Enter custom instructions…", rows: 3, style: S.textarea })
      );
    }

    function renderModelCard(title, icon, modelCfg) {
      if (!modelCfg) return null;
      return h("div", { style: { marginBottom: 10, padding: "10px 12px", background: "#0d1117", border: "1px solid #21262d", borderRadius: 6 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
          h("span", { style: { fontWeight: 600, fontSize: "0.85em" } }, icon, " ", title),
          h("span", { style: { fontSize: "0.72em", color: "#8b949e", padding: "2px 8px", background: "#161b22", borderRadius: 4, border: "1px solid #30363d" } }, modelCfg.transport || "")
        ),
        h("div", { style: { fontFamily: "monospace", fontSize: "0.82em", color: "#58a6ff", marginBottom: 2 } }, modelCfg.model || "unknown"),
        h("div", { style: { fontSize: "0.72em", color: "#8b949e" } },
          modelCfg.max_output_tokens != null ? "Max output: " + modelCfg.max_output_tokens + " · " : "",
          "Thinking: ", h("strong", null, modelCfg.thinking_budget_tokens != null ? String(modelCfg.thinking_budget_tokens) : "—")
        )
      );
    }

    function extractModels(gc) {
      if (!gc) return {};
      var dia = gc.dialectic || {};
      var lvls = dia.levels || {};
      return {
        deriver: (gc.deriver || {}).model_config || null,
        dialectic: { minimal: (lvls.minimal || {}).model_config || null, low: (lvls.low || {}).model_config || null, medium: (lvls.medium || {}).model_config || null, high: (lvls.high || {}).model_config || null, max: (lvls.max || {}).model_config || null },
        summary: (gc.summary || {}).model_config || null,
        dream: { main: ((gc.dream || {}).main_model_config) || null, deduction: ((gc.dream || {}).deduction_model_config) || null, induction: ((gc.dream || {}).induction_model_config) || null },
        embedding: (gc.embedding || {}).model_config || null,
      };
    }

    if (loading && !config) return h("div", { style: { padding: 40, color: "#8b949e" } }, "Loading…");
    if (error) return h("div", { style: { padding: 40, color: "#f85149", cursor: "pointer" }, onClick: loadConfig },
      h("div", null, "⚠️ Failed to load"), h("div", { style: { fontSize: "0.82em", marginTop: 4 } }, error),
      h("div", { style: { fontSize: "0.75em", marginTop: 8, color: "#8b949e" } }, "Click to retry.")
    );

    var models = extractModels(globalConfig);
    var hasGlobalEdits = Object.keys(editedGlobal).length > 0;

    return h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
        h("h2", { style: { margin: 0 } }, "Configuration")
      ),

      // ── GLOBAL SETTINGS ─────────────────────────────────────────────
      h("div", { style: S.section },
        h("div", { style: S.sectionTitle }, "🌐 Global Settings"),
        h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginBottom: 12 } }, "Server-level defaults. Changes restart the Honcho service."),
        h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 14 } },
          globalSaveMsg ? h("span", { style: { fontSize: "0.78em", color: globalSaveMsg.type === "ok" ? "#3fb950" : "#f85149" } }, globalSaveMsg.text) : null,
          h("button", { onClick: handleSaveGlobal, disabled: globalSaving || !hasGlobalEdits, style: hasGlobalEdits ? S.btnPrimary : S.btn },
            globalSaving ? "Saving…" : (hasGlobalEdits ? "💾 Save Global Changes" : "No changes")
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "⚡ Deriver"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderToggle("Enabled", "deriver.ENABLED", false),
            renderNumber("Workers", "deriver.WORKERS", false, null, 1, 20),
            renderNumber("Polling interval (s)", "deriver.POLLING_SLEEP_INTERVAL_SECONDS", false, null, 0.1, 60),
            renderNumber("Stale timeout (min)", "deriver.STALE_SESSION_TIMEOUT_MINUTES", false, null, 1, 60),
            renderToggle("Deduplicate", "deriver.DEDUPLICATE", false),
            renderToggle("Flush enabled", "deriver.FLUSH_ENABLED", false)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "🗣 Dialectic"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderNumber("Max output tokens", "dialectic.MAX_OUTPUT_TOKENS", false, null, 256, 32768),
            renderNumber("Max input tokens", "dialectic.MAX_INPUT_TOKENS", false, null, 1000, 200000),
            renderNumber("History token limit", "dialectic.HISTORY_TOKEN_LIMIT", false, null, 1000, 24000)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "📝 Summary"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderToggle("Enabled", "summary.ENABLED", false),
            renderNumber("Messages per short", "summary.MESSAGES_PER_SHORT_SUMMARY", false, "Min 10", 10, 500),
            renderNumber("Messages per long", "summary.MESSAGES_PER_LONG_SUMMARY", false, "Min 20", 20, 1000)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "💤 Dream"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderToggle("Enabled", "dream.ENABLED", false),
            renderNumber("Document threshold", "dream.DOCUMENT_THRESHOLD", false, null, 10, 1000),
            renderNumber("Idle timeout (min)", "dream.IDLE_TIMEOUT_MINUTES", false, null, 5, 480),
            renderNumber("Min hours between", "dream.MIN_HOURS_BETWEEN_DREAMS", false, null, 1, 72),
            renderNumber("Max tool iterations", "dream.MAX_TOOL_ITERATIONS", false, null, 1, 50)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "👤 Peer Cards"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderToggle("Enabled", "peer_card.ENABLED", false)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "🔢 Embedding"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderNumber("Vector dimensions", "embedding.VECTOR_DIMENSIONS", false, null, 128, 3072),
            renderNumber("Max input tokens", "embedding.MAX_INPUT_TOKENS", false, null, 512, 32768)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "💾 Cache"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderToggle("Enabled", "cache.ENABLED", false),
            renderNumber("Default TTL (s)", "cache.DEFAULT_TTL_SECONDS", false, null, 30, 3600)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "⚙️ App"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderNumber("Session observers limit", "app.SESSION_OBSERVERS_LIMIT", false, null, 1, 50),
            renderToggle("Embed messages", "app.EMBED_MESSAGES", false)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "🔐 Auth"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderToggle("Use auth", "auth.USE_AUTH", false)
          )
        ),

        h("div", { style: { marginBottom: 14 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.85em", marginBottom: 6, color: "#c9d1d9" } }, "🗄 Vector Store"),
          h("div", { style: { background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" } },
            renderNumber("Dimensions", "vector_store.DIMENSIONS", false, null, 128, 3072)
          )
        ),

        // Models subsection
        h("div", { style: { marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: "0.9em", color: "#c9d1d9" } }, "🤖 Models"),
        models.deriver ? renderModelCard("Deriver", "⚡", models.deriver) : null,
        models.summary ? renderModelCard("Summary", "📝", models.summary) : null,
        models.embedding ? renderModelCard("Embedding", "🔢", models.embedding) : null,
        models.dream && models.dream.main ? renderModelCard("Dream (Main)", "💤", models.dream.main) : null,
        models.dream && models.dream.deduction ? renderModelCard("Dream (Deduction)", "🔍", models.dream.deduction) : null,
        models.dream && models.dream.induction ? renderModelCard("Dream (Induction)", "💡", models.dream.induction) : null,
        h("div", { style: { marginTop: 8, marginBottom: 4, fontWeight: 600, fontSize: "0.82em", color: "#8b949e" } }, "Dialectic Levels"),
        models.dialectic && models.dialectic.minimal ? renderModelCard("Minimal", "○", models.dialectic.minimal) : null,
        models.dialectic && models.dialectic.low ? renderModelCard("Low", "◔", models.dialectic.low) : null,
        models.dialectic && models.dialectic.medium ? renderModelCard("Medium", "◑", models.dialectic.medium) : null,
        models.dialectic && models.dialectic.high ? renderModelCard("High", "◕", models.dialectic.high) : null,
        models.dialectic && models.dialectic.max ? renderModelCard("Max", "●", models.dialectic.max) : null
      ),

      // ── WORKSPACE OVERRIDES ──────────────────────────────────────────
      h("div", { style: S.section },
        h("div", { style: S.sectionTitle }, "🔧 Workspace Overrides"),
        h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginBottom: 12 } }, "Override global defaults. Greyed-out = using global default."),
        h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 14 } },
          saveMsg ? h("span", { style: { fontSize: "0.78em", color: saveMsg.type === "ok" ? "#3fb950" : "#f85149" } }, saveMsg.text) : null,
          h("button", { onClick: handleSaveWorkspace, disabled: saving, style: S.btnPrimary }, saving ? "Saving…" : "💾 Save Workspace Overrides")
        ),

        renderToggle("Enable Reasoning", "reasoning.enabled", true, "Override global deriver setting"),
        renderTextarea("Custom Instructions", "reasoning.custom_instructions", "Optional custom instructions"),

        h("div", { style: { marginTop: 12, marginBottom: 6, fontWeight: 600, fontSize: "0.82em", color: "#8b949e" } }, "Peer Cards"),
        renderToggle("Use Peer Cards", "peer_card.use", true, "Override global peer card setting"),
        renderToggle("Create Peer Cards", "peer_card.create", true, "Override global peer card creation"),

        h("div", { style: { marginTop: 12, marginBottom: 6, fontWeight: 600, fontSize: "0.82em", color: "#8b949e" } }, "Summaries"),
        renderToggle("Enable Summaries", "summary.enabled", true, "Override global summary setting"),
        renderNumber("Messages per Short", "summary.messages_per_short_summary", true, "Min 10", 10, 500),
        renderNumber("Messages per Long", "summary.messages_per_long_summary", true, "Min 20", 20, 1000),

        h("div", { style: { marginTop: 12, marginBottom: 6, fontWeight: 600, fontSize: "0.82em", color: "#8b949e" } }, "Dream"),
        renderToggle("Enable Dream", "dream.enabled", true, "Override global dream setting")
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Import Tab — import Hermes sessions into Honcho
  // ---------------------------------------------------------------------------

  function ImportTab() {
    var _u = useState(null), sessions = _u[0], setSessions = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];
    var _u4 = useState([]), selected = _u4[0], setSelected = _u4[1];
    var _u5 = useState(null), peers = _u5[0], setPeers = _u5[1];
    var _u6 = useState(""), userPeer = _u6[0], setUserPeer = _u6[1];
    var _u7 = useState(""), assistantPeer = _u7[0], setAssistantPeer = _u7[1];
    var _u8 = useState(""), filterText = _u8[0], setFilterText = _u8[1];
    var _u9 = useState(false), dryRun = _u9[0], setDryRun = _u9[1];
    var _u10 = useState(false), importing = _u10[0], setImporting = _u10[1];
    var _u11 = useState(null), importResult = _u11[0], setImportResult = _u11[1];
    var _u12 = useState(false), confirmImport = _u12[0], setConfirmImport = _u12[1];

    function loadSessions() {
      setLoading(true); setError(null);
      fetchJSON(API + "/hermes-sessions")
        .then(function (d) {
          setSessions(d);
          // Default: select only non-imported sessions
          var toSelect = (d.sessions || []).filter(function (s) { return !s.already_imported; }).map(function (s) { return s.id; });
          setSelected(toSelect);
        })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }

    function loadPeers() {
      fetchJSON(API + "/peers")
        .then(function (d) { setPeers(d); })
        .catch(function () { /* best-effort */ });
    }

    useEffect(function () { loadSessions(); loadPeers(); }, []);

    function toggleSession(id) {
      var idx = selected.indexOf(id);
      if (idx >= 0) {
        selected.splice(idx, 1);
      } else {
        selected.push(id);
      }
      setSelected(selected.slice());
    }

    function selectAll() {
      var ids = filteredSessions().map(function (s) { return s.id; });
      setSelected(ids);
    }

    function deselectAll() {
      setSelected([]);
    }

    function filteredSessions() {
      if (!sessions || !sessions.sessions) return [];
      if (!filterText.trim()) return sessions.sessions;
      var q = filterText.toLowerCase();
      return sessions.sessions.filter(function (s) {
        return (s.title || s.id).toLowerCase().indexOf(q) >= 0;
      });
    }

    function handleImport() {
      if (!userPeer || !assistantPeer) {
        setError("Please select both User and Assistant peers");
        return;
      }
      if (selected.length === 0) {
        setError("No sessions selected");
        return;
      }
      setImportResult(null);
      setImporting(true);
      fetch(API + "/import-sessions", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          session_ids: selected,
          user_peer_id: userPeer,
          assistant_peer_id: assistantPeer,
          dry_run: dryRun,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { setImportResult(d); })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setImporting(false); });
    }

    function formatDate(ts) {
      if (!ts) return "unknown";
      var d = new Date(ts * 1000);
      return d.toLocaleDateString() + " " + d.toLocaleTimeString();
    }

    if (loading && !sessions) return h("div", { style: { padding: 40, color: "#8b949e" } }, "Loading sessions…");
    if (error && !sessions) return h("div", { style: { padding: 40, color: "#f85149", cursor: "pointer" }, onClick: loadSessions },
      h("div", null, "⚠️ " + error),
      h("div", { style: { fontSize: "0.75em", marginTop: 8, color: "#8b949e" } }, "Click to retry.")
    );

    var peerItems = (peers && peers.peers) || [];
    var totalMessages = selected.reduce(function (acc, sid) {
      var s = (sessions.sessions || []).find(function (x) { return x.id === sid; });
      return acc + (s ? s.total_importable : 0);
    }, 0);

    return h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
        h("h2", { style: { margin: 0 } }, "📥 Import from Hermes"),
        importResult && importResult.summary
          ? h("span", { style: { fontSize: "0.78em", color: importResult.success ? "#3fb950" : "#f85149" } },
              importResult.dry_run ? "Dry run" : "Done",
              " · " + importResult.summary.imported + " imported, " + importResult.summary.errors + " errors"
            )
          : null
      ),

      // ── PEER MAPPING ─────────────────────────────────────────────────
      h("div", { style: S.section },
        h("div", { style: S.sectionTitle }, "👥 Peer Mapping"),
        h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginBottom: 12 } },
          "Map Hermes conversation roles to Honcho peers. Each session becomes a new Honcho session."
        ),
        h("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 } },
          h("div", null,
            h("label", { style: { fontSize: "0.8em", color: "#8b949e", display: "block", marginBottom: 4 } }, "User role →"),
            h("select", { value: userPeer, onChange: function (e) { setUserPeer(e.target.value); }, style: Object.assign({}, S.input, { minWidth: 180 }) },
              h("option", { value: "" }, "Select peer…"),
              peerItems.map(function (p) { return h("option", { key: p.id, value: p.id }, p.name || p.id); })
            )
          ),
          h("div", null,
            h("label", { style: { fontSize: "0.8em", color: "#8b949e", display: "block", marginBottom: 4 } }, "Assistant role →"),
            h("select", { value: assistantPeer, onChange: function (e) { setAssistantPeer(e.target.value); }, style: Object.assign({}, S.input, { minWidth: 180 }) },
              h("option", { value: "" }, "Select peer…"),
              peerItems.map(function (p) { return h("option", { key: p.id, value: p.id }, p.name || p.id); })
            )
          )
        )
      ),

      // ── SESSION LIST ─────────────────────────────────────────────────
      h("div", { style: S.section },
        h("div", { style: S.sectionTitle }, "📋 Hermes Sessions"),
        h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" } },
          h("input", {
            type: "text", placeholder: "Filter sessions…", value: filterText,
            onChange: function (e) { setFilterText(e.target.value); },
            style: Object.assign({}, S.input, { flex: 1, minWidth: 200 }),
          }),
          h("button", { onClick: selectAll, style: S.btn }, "Select All"),
          h("button", { onClick: deselectAll, style: S.btn }, "Select None"),
          h("label", { style: { display: "flex", alignItems: "center", gap: 4, fontSize: "0.78em", color: "#8b949e" } },
            h("input", { type: "checkbox", checked: dryRun, onChange: function (e) { setDryRun(e.target.checked); } }),
            "Dry run"
          )
        ),

        h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginBottom: 8 } },
          selected.length + " selected" + (totalMessages > 0 ? " · ~" + totalMessages + " messages" : "") +
          (sessions ? " · " + sessions.imported_count + " already imported" : "")
        ),

        // Warning for large imports
        selected.length > 5 || totalMessages > 500
          ? h("div", { style: { padding: "8px 12px", background: "#3f2c00", border: "1px solid #d29922", borderRadius: 6, marginBottom: 12, fontSize: "0.78em", color: "#d29922" } },
              "⚠️ Large import (" + selected.length + " sessions, ~" + totalMessages + " messages). This may take a while."
            )
          : null,

        // Session list
        h("div", { style: { maxHeight: 400, overflowY: "auto", border: "1px solid #21262d", borderRadius: 6 } },
          filteredSessions().map(function (s) {
            var isSelected = selected.indexOf(s.id) >= 0;
            return h("div", {
              key: s.id,
              style: {
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", borderBottom: "1px solid #21262d",
                background: isSelected ? "#161b22" : "transparent",
                opacity: s.already_imported ? 0.6 : 1,
              }
            },
              h("input", {
                type: "checkbox", checked: isSelected,
                onChange: function () { toggleSession(s.id); },
              }),
              h("div", { style: { flex: 1, minWidth: 0 } },
                h("div", { style: { fontSize: "0.82em", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
                  s.title || s.id
                ),
                h("div", { style: { fontSize: "0.7em", color: "#8b949e", marginTop: 2 } },
                  formatDate(s.started_at) + " · " + s.source + " · " + s.user_messages + " user / " + s.assistant_messages + " asst"
                )
              ),
              s.already_imported
                ? h("span", { style: { fontSize: "0.68em", color: "#3fb950", padding: "2px 6px", background: "#0d1117", borderRadius: 4, border: "1px solid #238636", whiteSpace: "nowrap" } }, "✓ imported")
                : null
            );
          })
        )
      ),

      // ── IMPORT BUTTON ─────────────────────────────────────────────────
      h("div", { style: { marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
        importResult && importResult.success && !dryRun
          ? h("button", { onClick: function () { loadSessions(); setImportResult(null); }, style: S.btnPrimary },
              "🔄 Refresh List"
            )
          : h("button", {
              onClick: handleImport,
              disabled: importing || selected.length === 0 || !userPeer || !assistantPeer,
              style: (selected.length > 0 && userPeer && assistantPeer) ? S.btnPrimary : S.btn,
            },
              importing ? "Importing…" : (dryRun ? "🔍 Dry Run (" + selected.length + ")" : "📥 Import " + selected.length + " Session" + (selected.length !== 1 ? "s" : ""))
            ),
        importing ? h("span", { style: { fontSize: "0.75em", color: "#8b949e" } }, "Processing…") : null
      ),

      // ── IMPORT RESULTS ───────────────────────────────────────────────
      importResult && importResult.results
        ? h("div", { style: { marginTop: 16 } },
            h("div", { style: S.sectionTitle }, importResult.dry_run ? "Dry Run Results" : "Import Results"),
            h("div", { style: { maxHeight: 300, overflowY: "auto", border: "1px solid #21262d", borderRadius: 6 } },
              importResult.results.map(function (r, i) {
                var color = r.status === "imported" ? "#3fb950" : r.status === "error" ? "#f85149" : r.status === "dry_run" ? "#58a6ff" : "#8b949e";
                var icon = r.status === "imported" ? "✓" : r.status === "error" ? "✗" : r.status === "dry_run" ? "🔍" : "○";
                return h("div", { key: i, style: { padding: "6px 12px", borderBottom: "1px solid #21262d", fontSize: "0.78em" } },
                  h("span", { style: { color: color, marginRight: 6 } }, icon),
                  h("span", null, r.session_id.slice(0, 20)),
                  r.honcho_session ? h("span", { style: { color: "#8b949e", marginLeft: 6 } }, "→ " + r.honcho_session) : null,
                  r.messages_imported != null ? h("span", { style: { color: "#8b949e", marginLeft: 6 } }, "(" + r.messages_imported + " msgs)") : null,
                  r.reason ? h("span", { style: { color: "#f85149", marginLeft: 6 } }, "— " + r.reason) : null
                );
              })
            )
          )
        : null
    );
  }

  // ---------------------------------------------------------------------------
  // Main App — tab router
  // ---------------------------------------------------------------------------

  function App() {
    var _u = useState("overview"), tab = _u[0], setTab = _u[1];

    var tabs = [
      { key: "overview", label: "Overview" },
      { key: "peers", label: "Peers" },
      { key: "sessions", label: "Sessions" },
      { key: "conclusions", label: "Conclusions" },
      { key: "search", label: "Search" },
      { key: "analytics", label: "Analytics" },
      { key: "status", label: "Status" },
      { key: "dreams", label: "Dreams" },
      { key: "config", label: "Config" },
      { key: "import", label: "Import" },
    ];

    var content;
    if (tab === "overview") content = h(OverviewTab);
    else if (tab === "peers") content = h(PeersTab);
    else if (tab === "sessions") content = h(SessionsTab);
    else if (tab === "conclusions") content = h(ConclusionsTab);
    else if (tab === "search") content = h(SearchTab);
    else if (tab === "analytics") content = h(AnalyticsTab);
    else if (tab === "status") content = h(StatusTab);
    else if (tab === "dreams") content = h(DreamsTab);
    else if (tab === "config") content = h(ConfigTab);
    else if (tab === "import") content = h(ImportTab);

    return h("div", { style: S.page },
      h("div", { style: S.header },
        h("div", { style: S.headerTitle }, "🧠 Honcho Dashboard")
      ),
      h("div", { style: S.tabs },
        tabs.map(function (t) {
          return h(TabBtn, { key: t.key, label: t.label, active: tab === t.key, onClick: function () { setTab(t.key); } });
        })
      ),
      h("div", { style: S.body }, content)
    );
  }

  // Register the plugin
  window.__HERMES_PLUGINS__.register("honcho-dashboard", App);
  console.log("[Honcho Dashboard] Registered successfully");

  } catch (err) {
    console.error("[Honcho Dashboard] Fatal error during initialization:", err);
  }
})();
