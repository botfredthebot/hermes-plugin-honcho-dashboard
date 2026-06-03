/**
 * Honcho Dashboard — Hermes Dashboard Plugin
 *
 * Tabs: Overview, Peers, Sessions, Conclusions, Search, Analytics, Status.
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

    return h("div", null,
      h("div", { style: { fontWeight: 600, fontSize: "0.92em", color: "#8b949e", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" } },
        "Peers (" + peers.length + ")"
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
        emptySessions.length > 0
          ? h("button", { onClick: deleteAllEmpty, style: S.btnDelete },
              "🗑 Delete All Empty (", emptySessions.length, ")")
          : null
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

    // Load conclusions (filtered)
    function loadConclusions() {
      setLoading(true);
      var url = API + "/conclusions?limit=100";
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

    // Build peer options from loaded peers
    var peerOptions = allPeers.map(function (p) {
      var label = p.metadata && p.metadata.name ? p.metadata.name : p.id;
      return { value: p.id, label: label };
    });

    return h("div", null,
      // Filter row
      h("div", { style: { marginBottom: 16, display: "flex", gap: 8, alignItems: "center" } },
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
        filterPeer ? h("button", { onClick: function () { setFilterPeer(""); }, style: S.btn }, "✕ Clear") : null
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
  // Status Tab — includes DB status badge
  // ---------------------------------------------------------------------------

  function StatusTab() {
    var _u = useState(null), data = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];

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
  // Config Tab — view and edit Honcho workspace configuration
  // ---------------------------------------------------------------------------

  function ConfigTab() {
    var _u = useState(null), config = _u[0], setConfig = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), error = _u3[0], setError = _u3[1];
    var _u4 = useState(false), saving = _u4[0], setSaving = _u4[1];
    var _u5 = useState(null), saveMsg = _u5[0], setSaveMsg = _u5[1];
    var _u6 = useState(null), globalConfig = _u6[0], setGlobalConfig = _u6[1];
    var _u7 = useState(true), globalLoading = _u7[0], setGlobalLoading = _u7[1];

    function loadConfig() {
      setLoading(true);
      setError(null);
      fetchJSON(API + "/config")
        .then(function (d) { setConfig(d); })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }

    function loadGlobalConfig() {
      setGlobalLoading(true);
      fetchJSON(API + "/global-config")
        .then(function (d) { setGlobalConfig(d); })
        .catch(function () { /* global config is best-effort */ })
        .finally(function () { setGlobalLoading(false); });
    }

    useEffect(function () { loadConfig(); loadGlobalConfig(); }, []);

    function updateField(path, value) {
        var parts = path.split(".");
        var newConfig = JSON.parse(JSON.stringify(config || {}));
        var obj = newConfig.configuration = newConfig.configuration || {};
        for (var i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") {
            obj[parts[i]] = {};
          }
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
        setConfig(newConfig);
      }

      function handleSave() {
        if (!config) return;
        setSaving(true);
        setSaveMsg(null);
        fetch(API + "/config", {
          method: "PUT",
          headers: Object.assign({}, authHeaders(), {"Content-Type": "application/json"}),
          body: JSON.stringify({ configuration: config.configuration || {} }),
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.success) {
              setSaveMsg({ type: "ok", text: "Configuration saved successfully." });
              loadConfig();
            } else {
              setSaveMsg({ type: "err", text: (d.detail || "Save failed") });
            }
          })
          .catch(function (e) { setSaveMsg({ type: "err", text: e.message }); })
          .finally(function () { setSaving(false); });
      }

      // ── Toggle switch ──────────────────────────────────────────────────
      function renderToggle(label, path, description) {
        var parts = path.split(".");
        var cfg = (config && config.configuration) || {};
        for (var i = 0; i < parts.length; i++) {
          if (!cfg || typeof cfg !== "object") { cfg = null; break; }
          cfg = cfg[parts[i]];
        }
        var isOn = cfg === true;
        return h("div", { style: { marginBottom: 16 } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            h("div", null,
              h("div", { style: { fontWeight: 600, fontSize: "0.88em" } }, label),
              description ? h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginTop: 2 } }, description) : null
            ),
            h("button", {
              onClick: function () { updateField(path, !isOn); },
              title: isOn ? "Currently ON — click to disable" : "Currently OFF — click to enable",
              style: {
                width: 48, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
                background: isOn ? "#238636" : "#30363d",
                position: "relative", padding: 0, transition: "background 0.2s",
              },
            },
              h("div", {
                style: {
                  width: 20, height: 20, borderRadius: 10, background: "#fff",
                  position: "absolute", top: 3, left: isOn ? 25 : 3,
                  transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                },
              })
            )
          )
        );
      }

      // ── Number input ───────────────────────────────────────────────────
      function renderNumber(label, path, description, min, max) {
        var parts = path.split(".");
        var cfg = (config && config.configuration) || {};
        for (var i = 0; i < parts.length; i++) {
          if (!cfg || typeof cfg !== "object") { cfg = null; break; }
          cfg = cfg[parts[i]];
        }
        var val = (cfg != null) ? cfg : "";
        return h("div", { style: { marginBottom: 16 } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            h("div", null,
              h("div", { style: { fontWeight: 600, fontSize: "0.88em" } }, label),
              description ? h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginTop: 2 } }, description) : null
            ),
            h("input", {
              type: "number",
              min: min, max: max, value: val,
              onChange: function (e) {
                var v = parseInt(e.target.value, 10);
                if (!isNaN(v)) updateField(path, v);
              },
              style: Object.assign({}, S.input, { width: "100px", textAlign: "center" }),
            })
          )
        );
      }

      // ── Textarea ───────────────────────────────────────────────────────
      function renderTextarea(label, path, description) {
        var parts = path.split(".");
        var cfg = (config && config.configuration) || {};
        for (var i = 0; i < parts.length; i++) {
          if (!cfg || typeof cfg !== "object") { cfg = null; break; }
          cfg = cfg[parts[i]];
        }
        var val = (cfg != null) ? cfg : "";
        return h("div", { style: { marginBottom: 16 } },
          h("div", { style: { fontWeight: 600, fontSize: "0.88em", marginBottom: 4 } }, label),
          description ? h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginBottom: 6 } }, description) : null,
          h("textarea", {
            value: val,
            onChange: function (e) { updateField(path, e.target.value); },
            placeholder: "Enter custom instructions…",
            rows: 3, style: S.textarea,
          })
        );
      }

      // ── Model info display ─────────────────────────────────────────────
      function renderModelSection(title, icon, modelCfg) {
        if (!modelCfg) return null;
        var model = modelCfg.model || "unknown";
        var transport = modelCfg.transport || "";
        var maxTokens = modelCfg.max_output_tokens || modelCfg.max_tokens || "—";
        var thinking = modelCfg.thinking_budget_tokens;
        return h("div", { style: { marginBottom: 12, padding: "10px 12px", background: "#0d1117", border: "1px solid #21262d", borderRadius: 6 } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
            h("span", { style: { fontWeight: 600, fontSize: "0.85em" } }, icon, " ", title),
            h("span", { style: { fontSize: "0.72em", color: "#8b949e", padding: "2px 8px", background: "#161b22", borderRadius: 4, border: "1px solid #30363d" } }, transport)
          ),
          h("div", { style: { fontFamily: "monospace", fontSize: "0.82em", color: "#58a6ff", marginBottom: 2 } }, model),
          h("div", { style: { fontSize: "0.72em", color: "#8b949e" } },
            "Max tokens: ", h("strong", null, String(maxTokens)),
            thinking != null ? h("span", null, " · Thinking budget: ", h("strong", null, String(thinking))) : null
          )
        );
      }

      function extractModels(gc) {
        if (!gc) return {};
        return {
          deriver: gc.deriver ? gc.deriver.model_config : null,
          dialectic: {
            minimal: gc.dialectic && gc.dialectic.levels ? gc.dialectic.levels.minimal : null,
            low: gc.dialectic && gc.dialectic.levels ? gc.dialectic.levels.low : null,
            medium: gc.dialectic && gc.dialectic.levels ? gc.dialectic.levels.medium : null,
            high: gc.dialectic && gc.dialectic.levels ? gc.dialectic.levels.high : null,
            max: gc.dialectic && gc.dialectic.levels ? gc.dialectic.levels.max : null,
          },
          summary: gc.summary ? gc.summary.model_config : null,
          dream: {
            main: gc.dream ? gc.dream.main_model_config : null,
            deduction: gc.dream ? gc.dream.deduction_model_config : null,
            induction: gc.dream ? gc.dream.induction_model_config : null,
          },
          embedding: gc.embedding ? gc.embedding.model_config : null,
        };
      }

      if (loading) return h("div", { style: { padding: 40, color: "#8b949e" } }, "Loading configuration…");
      if (error) return h("div", { style: { padding: 40, color: "#f85149", cursor: "pointer" }, onClick: loadConfig },
        h("div", null, "⚠️ Failed to load configuration"),
        h("div", { style: { fontSize: "0.82em", marginTop: 4 } }, error),
        h("div", { style: { fontSize: "0.75em", marginTop: 8, color: "#8b949e" } }, "Click to retry. If this persists, the gateway may need a restart.")
      );

      var models = extractModels(globalConfig);

      return h("div", null,
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
          h("h2", { style: { margin: 0 } }, "Workspace Configuration"),
          h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
            saveMsg
              ? h("span", { style: { fontSize: "0.78em", color: saveMsg.type === "ok" ? "#3fb950" : "#f85149" } }, saveMsg.text)
              : null,
            h("button", { onClick: handleSave, disabled: saving, style: S.btnPrimary },
              saving ? "Saving…" : "💾 Save Changes")
          )
        ),

        h("div", { style: S.section },
          h("div", { style: S.sectionTitle }, "🧠 Reasoning"),
          renderToggle("Enable Reasoning", "reasoning.enabled", "Whether Honcho will use reasoning to form representations and draw conclusions"),
          renderTextarea("Custom Instructions", "reasoning.custom_instructions", "Optional custom instructions for the reasoning system")
        ),

        h("div", { style: S.section },
          h("div", { style: S.sectionTitle }, "👤 Peer Cards"),
          renderToggle("Use Peer Cards", "peer_card.use", "Whether to use peer cards during the reasoning process"),
          renderToggle("Create Peer Cards", "peer_card.create", "Whether to generate peer cards based on content")
        ),

        h("div", { style: S.section },
          h("div", { style: S.sectionTitle }, "📝 Summaries"),
          renderToggle("Enable Summaries", "summary.enabled", "Whether to enable session summary functionality"),
          renderNumber("Messages per Short Summary", "summary.messages_per_short_summary", "Number of messages before generating a short summary (min 10)", 10, 500),
          renderNumber("Messages per Long Summary", "summary.messages_per_long_summary", "Number of messages before generating a long summary (min 20)", 20, 1000)
        ),

        h("div", { style: S.section },
          h("div", { style: S.sectionTitle }, "💤 Dream"),
          renderToggle("Enable Dream", "dream.enabled", "Whether Honcho will run background 'dream' processing")
        ),

        // ── Models section ──────────────────────────────────────────────
        h("div", { style: S.section },
          h("div", { style: S.sectionTitle }, "🤖 Models"),
          globalLoading
            ? h("div", { style: { color: "#8b949e", fontSize: "0.82em", padding: "8px 0" } }, "Loading model info…")
            : !globalConfig
            ? h("div", { style: { color: "#8b949e", fontSize: "0.82em", padding: "8px 0" } }, "Model info unavailable (gateway may need a restart)")
            : h("div", null,
                models.deriver ? renderModelSection("Deriver", "⚡", models.deriver) : null,
                models.summary ? renderModelSection("Summary", "📝", models.summary) : null,
                models.embedding ? renderModelSection("Embedding", "🔢", models.embedding) : null,
                models.dream && models.dream.main ? renderModelSection("Dream (Main)", "💤", models.dream.main) : null,
                models.dream && models.dream.deduction ? renderModelSection("Dream (Deduction)", "🔍", models.dream.deduction) : null,
                models.dream && models.dream.induction ? renderModelSection("Dream (Induction)", "💡", models.dream.induction) : null,
                // Dialectic levels
                h("div", { style: { marginTop: 8, marginBottom: 4, fontWeight: 600, fontSize: "0.85em", color: "#c9d1d9" } }, "🗣 Dialectic Levels"),
                models.dialectic && models.dialectic.minimal ? renderModelSection("Minimal", "○", models.dialectic.minimal.model_config) : null,
                models.dialectic && models.dialectic.low ? renderModelSection("Low", "◔", models.dialectic.low.model_config) : null,
                models.dialectic && models.dialectic.medium ? renderModelSection("Medium", "◑", models.dialectic.medium.model_config) : null,
                models.dialectic && models.dialectic.high ? renderModelSection("High", "◕", models.dialectic.high.model_config) : null,
                models.dialectic && models.dialectic.max ? renderModelSection("Max", "●", models.dialectic.max.model_config) : null,
              )
        )
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
      { key: "config", label: "Config" },
    ];

    var content;
    if (tab === "overview") content = h(OverviewTab);
    else if (tab === "peers") content = h(PeersTab);
    else if (tab === "sessions") content = h(SessionsTab);
    else if (tab === "conclusions") content = h(ConclusionsTab);
    else if (tab === "search") content = h(SearchTab);
    else if (tab === "analytics") content = h(AnalyticsTab);
    else if (tab === "status") content = h(StatusTab);
    else if (tab === "config") content = h(ConfigTab);

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
