/**
 * Honcho Dashboard — Hermes Dashboard Plugin
 *
 * Tabs: Overview, Peers, Sessions, Conclusions, Search, Analytics, Status.
 * Features: sidebar nav, back-button nav stack, peer drill-down,
 *   vector search, analytics charts, queue status, add insight.
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
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
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

    // Cards
    card: {
      background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
      padding: "14px 16px", marginBottom: 10, cursor: "pointer",
    },
    cardStatic: {
      background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
      padding: "14px 16px", marginBottom: 10,
    },
    cardSelected: { border: "1px solid #58a6ff" },

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

    // Two-pane
    twoPane: { display: "flex", gap: 24 },
    leftPane: { flex: "0 0 340px", overflowY: "auto", maxHeight: "calc(100vh - 200px)" },
    rightPane: { flex: 1, overflowY: "auto", maxHeight: "calc(100vh - 200px)" },
  };

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
    if (error) return h("div", { style: { padding: 40, color: "#f85149" }, }, "⚠️ " + error);
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
              return h("div", { key: c.id || String(i), style: S.cardStatic },
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
  // Peers Tab
  // ---------------------------------------------------------------------------

  function PeersTab() {
    var _u = useState([]), peers = _u[0], setPeers = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), selectedPeer = _u3[0], setSelectedPeer = _u3[1];

    function loadPeers() {
      setLoading(true);
      fetchJSON(API + "/peers")
        .then(function (d) { setPeers(d.peers || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }

    useEffect(function () { loadPeers(); }, []);

    function deletePeer(peerId, peerName) {
      if (!window.confirm("Delete peer '" + peerName + "' and all associated data?\n\nThis will remove:\n- The peer\n- All messages sent by this peer\n- All documents, collections, and session links\n\nThis cannot be undone.")) {
        return;
      }
      var token = window.__HERMES_SESSION_TOKEN__ || "";
      var headers = { "Content-Type": "application/json" };
      if (token) {
        headers["X-Hermes-Session-Token"] = token;
        headers["Authorization"] = "Bearer " + token;
      }
      fetch(API + "/peer/" + encodeURIComponent(peerId) + "?confirm=true", {
        method: "DELETE",
        headers: headers,
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            alert("Peer '" + peerName + "' deleted.\n\nRemoved: " +
              (d.deleted.messages || 0) + " messages, " +
              (d.deleted.documents || 0) + " documents, " +
              (d.deleted.collections || 0) + " collections.");
            if (selectedPeer === peerId) setSelectedPeer(null);
            loadPeers();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete failed: " + e.message); });
    }

    return h("div", { style: S.twoPane },
      h("div", { style: S.leftPane },
        loading
          ? h("div", { style: { color: "#8b949e" } }, "Loading…")
          : peers.map(function (p) {
              var isSelected = selectedPeer === p.id;
              var displayName = p.metadata && p.metadata.name ? p.metadata.name : p.id;
              return h("div", {
                  key: p.id,
                  style: Object.assign({}, S.card, isSelected ? S.cardSelected : {}),
                },
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
                  h("div", { style: { fontWeight: 600, fontSize: "0.95em" } }, displayName),
                  h("button", {
                    title: "Delete peer '" + displayName + "'",
                    onClick: function (e) {
                      e.stopPropagation();
                      deletePeer(p.id, displayName);
                    },
                    style: S.btnDelete,
                  }, "🗑 Delete")
                ),
                h("div", { style: { fontSize: "0.82em", color: "#8b949e", marginBottom: 6 } }, p.id),
                h("div", { style: S.small },
                  "Conclusions about: ", h("strong", null, String(p.conclusions_about || 0)),
                  " · By: ", h("strong", null, String(p.conclusions_by || 0))
                ),
                h("div", { style: { marginTop: 8 } },
                  h("button", {
                    onClick: function () { setSelectedPeer(isSelected ? null : p.id); },
                    style: S.btnSmall,
                  }, isSelected ? "✕ Close" : "👁 View Details")
                )
              );
            })
      ),
      h("div", { style: S.rightPane },
        selectedPeer
          ? h(PeerDetail, { peerId: selectedPeer, onDelete: function () { setSelectedPeer(null); loadPeers(); } })
          : h("div", { style: { color: "#8b949e", padding: 40, textAlign: "center" } }, "👈 Select a peer to view details")
      )
    );
  }

  function PeerDetail(props) {
    var peerId = props.peerId;
    var onDelete = props.onDelete;
    var _u = useState(null), data = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(false), showInsight = _u3[0], setShowInsight = _u3[1];
    var _u4 = useState(""), insightText = _u4[0], setInsightText = _u4[1];
    var _u5 = useState(false), showDeleteConfirm = _u5[0], setShowDeleteConfirm = _u5[1];
    var _u6 = useState(null), deletePreview = _u6[0], setDeletePreview = _u6[1];

    useEffect(function () {
      setLoading(true);
      fetchJSON(API + "/conclusions?observed_id=" + encodeURIComponent(peerId) + "&limit=100")
        .then(function (d) { setData(d); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, [peerId]);

    function submitInsight() {
      if (!insightText.trim()) return;
      fetch(API + "/peer/" + encodeURIComponent(peerId) + "/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: insightText }),
      })
        .then(function () { setInsightText(""); setShowInsight(false); })
        .catch(function () {});
    }

    function previewDelete() {
      var token = window.__HERMES_SESSION_TOKEN__ || "";
      var headers = { "Content-Type": "application/json" };
      if (token) {
        headers["X-Hermes-Session-Token"] = token;
        headers["Authorization"] = "Bearer " + token;
      }
      fetch(API + "/peer/" + encodeURIComponent(peerId), {
        method: "DELETE",
        headers: headers,
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { setDeletePreview(d); setShowDeleteConfirm(true); })
        .catch(function (e) { alert("Error: " + e.message); });
    }

    function confirmDelete() {
      var token = window.__HERMES_SESSION_TOKEN__ || "";
      var headers = { "Content-Type": "application/json" };
      if (token) {
        headers["X-Hermes-Session-Token"] = token;
        headers["Authorization"] = "Bearer " + token;
      }
      fetch(API + "/peer/" + encodeURIComponent(peerId) + "?confirm=true", {
        method: "DELETE",
        headers: headers,
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            alert("Peer '" + peerId + "' deleted.\n\nRemoved: " +
              (d.deleted.messages || 0) + " messages, " +
              (d.deleted.documents || 0) + " documents, " +
              (d.deleted.collections || 0) + " collections.");
            if (onDelete) onDelete();
          } else {
            alert("Error: " + (d.detail || "Unknown error"));
          }
        })
        .catch(function (e) { alert("Delete failed: " + e.message); });
    }

    var conclusions = (data && data.items) || [];

    return h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
        h("h3", { style: { margin: 0 } }, "Peer: ", h("code", null, peerId)),
        h("button", {
          onClick: previewDelete,
          style: S.btnDelete,
        }, "🗑 Delete Peer")
      ),

      // Delete confirmation modal
      showDeleteConfirm
        ? h("div", { style: Object.assign({}, S.insightBox, { borderColor: "#f85149", border: "1px solid #f85149", background: "#1a0a0a" }) },
            h("div", { style: { color: "#f85149", fontWeight: 600, marginBottom: 8 } }, "⚠️ Confirm Deletion"),
            deletePreview
              ? h("div", null,
                  h("div", { style: { marginBottom: 8 } },
                    "About to delete peer: ", h("strong", null, deletePreview.peer_name || peerId)
                  ),
                  h("div", { style: { fontSize: "0.82em", color: "#8b949e", marginBottom: 12 } },
                    "This will remove:",
                    h("ul", { style: { margin: "4px 0 0 16px", padding: 0 } },
                      h("li", null, (deletePreview.will_delete.peers || 0) + " peer"),
                      h("li", null, (deletePreview.will_delete.messages || 0) + " messages"),
                      h("li", null, (deletePreview.will_delete.documents || 0) + " documents"),
                      h("li", null, (deletePreview.will_delete.collections || 0) + " collections"),
                      h("li", null, (deletePreview.will_delete.session_peers || 0) + " session links"),
                    )
                  ),
                  h("div", { style: { display: "flex", gap: 8 } },
                    h("button", { onClick: confirmDelete, style: S.btnDeleteConfirm }, "🗑 Yes, Delete"),
                    h("button", { onClick: function () { setShowDeleteConfirm(false); setDeletePreview(null); }, style: S.btn }, "Cancel")
                  )
                )
              : h("div", { style: { color: "#8b949e" } }, "Loading preview…")
          )
        : null,

      // Add Insight
      h("div", { style: S.section },
        h("div", { style: S.sectionTitle },
          "🧠 Conclusions (", conclusions.length, ")",
          h("button", {
            onClick: function () { setShowInsight(!showInsight); },
            style: Object.assign({}, S.btnPrimary, { marginLeft: 12 }),
          }, showInsight ? "Cancel" : "➕ Add Insight")
        ),

        showInsight
          ? h("div", { style: S.insightBox },
              h("div", { style: S.insightLabel },
                "Submit an observation about ", h("strong", null, peerId), ". Honcho will process it and may derive new conclusions if it contains meaningful, novel insights."
              ),
              h("textarea", {
                style: S.textarea,
                rows: 3,
                placeholder: "e.g. Kit prefers concise emails with only filled-in fields — no empty TBC fields",
                value: insightText,
                onChange: function (e) { setInsightText(e.target.value); },
              }),
              h("button", { onClick: submitInsight, style: Object.assign({}, S.btnPrimary, { marginTop: 8 }) }, "⚡ Submit Insight")
            )
          : null,

        loading
          ? h("div", { style: { color: "#8b949e", padding: 20 } }, "Loading conclusions…")
          : conclusions.length === 0
          ? h("div", { style: { color: "#8b949e" } }, "No conclusions yet.")
          : conclusions.map(function (c, i) {
              return h("div", { key: c.id || String(i), style: S.cardStatic },
                h("div", { style: S.text }, c.content || ""),
                h("div", { style: S.small },
                  (c.observer_id || "?") + " → " + (c.observed_id || "?") + " · " + timeAgo(c.created_at)
                )
              );
            })
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Sessions Tab
  // ---------------------------------------------------------------------------

  function SessionsTab() {
    var _u = useState([]), sessions = _u[0], setSessions = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(null), expanded = _u3[0], setExpanded = _u3[1];

    useEffect(function () {
      fetchJSON(API + "/sessions")
        .then(function (d) { setSessions(d.sessions || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, []);

    return h("div", null,
      h("div", { style: { fontWeight: 600, marginBottom: 14 } },
        "All Sessions (", sessions.length, ")"
      ),
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Loading…")
        : sessions.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No sessions found.")
        : sessions.map(function (s) {
            return h("div", null,
              h("div", {
                  key: s.id, style: S.card,
                  onClick: function () { setExpanded(expanded === s.id ? null : s.id); },
                },
                h("div", { style: S.mono }, s.id),
                h("div", { style: S.small },
                  "Created: ", fmtDate(s.created_at), s.is_active ? " · Active" : "",
                  expanded === s.id ? " ▾" : " ▸"
                )
              ),
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
  // Conclusions Tab
  // ---------------------------------------------------------------------------

  function ConclusionsTab() {
    var _u = useState([]), conclusions = _u[0], setData = _u[1];
    var _u2 = useState(true), loading = _u2[0], setLoading = _u2[1];
    var _u3 = useState(""), filter = _u3[0], setFilter = _u3[1];

    useEffect(function () {
      var url = API + "/conclusions?limit=100";
      if (filter) url += "&observed_id=" + encodeURIComponent(filter);
      fetchJSON(url)
        .then(function (d) { setData(d.items || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, [filter]);

    return h("div", null,
      h("div", { style: { marginBottom: 16, display: "flex", gap: 8, alignItems: "center" } },
        h("input", {
          style: S.input,
          placeholder: "Filter by peer ID…",
          value: filter,
          onChange: function (e) { setFilter(e.target.value); },
        }),
        filter ? h("button", { onClick: function () { setFilter(""); }, style: S.btn }, "✕ Clear") : null
      ),
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Loading…")
        : conclusions.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No conclusions found.")
        : conclusions.map(function (c, i) {
            return h("div", { key: c.id || String(i), style: S.cardStatic },
              h("div", { style: { fontSize: "0.88em", lineHeight: 1.5, marginBottom: 8 } }, c.content || ""),
              h("div", { style: { fontSize: "0.75em", color: "#8b949e", display: "flex", justifyContent: "space-between", alignItems: "center" } },
                h("span", null,
                  (c.observer_id || "?") + " → " + (c.observed_id || "?") + " · " + timeAgo(c.created_at)
                )
              )
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
              return h("div", { key: String(i), style: S.cardStatic },
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
      h("div", { style: S.cardStatic },
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
      h("div", { style: Object.assign({}, S.cardStatic, { marginTop: 16 }) },
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
  // Status Tab
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

      h("div", { style: Object.assign({}, S.cardStatic, { marginTop: 16 }) },
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
              var barColor = active > 0 ? "#F59E0B" : "#10B981";
              return h("div", { key: s.session_id, style: S.queueRow },
                h("div", { style: { fontFamily: "monospace", fontSize: "0.82em", marginBottom: 4 } }, s.session_id),
                h("div", { style: { display: "flex", alignItems: "center" } },
                  h("div", { style: S.queueBarBg },
                    h("div", { style: Object.assign({}, S.queueBarFill, { width: pct + "%", background: barColor }) })
                  ),
                  h("span", { style: S.queuePct }, pct + "%")
                ),
                h("div", { style: { fontSize: "0.75em", color: "#8b949e", marginTop: 2 } },
                  done, "/", total, " ",
                  active > 0 ? h("span", { style: S.warn }, active + " active") : h("span", { style: S.ok }, "All done")
                )
              );
            }),
        h("div", { style: { color: "#64748B", fontSize: "0.75rem", marginTop: 16 } },
          "Last checked: ", new Date().toLocaleTimeString()
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Main Component
  // ---------------------------------------------------------------------------

  function HonchoDashboard() {
    var _u = useState("overview"), tab = _u[0], setTab = _u[1];

    var tabs = [
      { id: "overview", label: "Overview", icon: "📊" },
      { id: "peers", label: "Peers", icon: "👤" },
      { id: "sessions", label: "Sessions", icon: "💬" },
      { id: "conclusions", label: "Conclusions", icon: "🧠" },
      { id: "search", label: "Search", icon: "🔍" },
      { id: "analytics", label: "Analytics", icon: "📈" },
      { id: "status", label: "Status", icon: "📡" },
    ];

    var content;
    try {
      if (tab === "overview") content = h(OverviewTab);
      else if (tab === "peers") content = h(PeersTab);
      else if (tab === "sessions") content = h(SessionsTab);
      else if (tab === "conclusions") content = h(ConclusionsTab);
      else if (tab === "search") content = h(SearchTab);
      else if (tab === "analytics") content = h(AnalyticsTab);
      else if (tab === "status") content = h(StatusTab);
    } catch(e) {
      console.error("[Honcho Dashboard] Tab render error:", e);
      content = h("div", { style: { padding: 40, color: "#f85149" } }, "⚠️ Error rendering " + tab + ": " + e.message);
    }

    return h("div", { style: S.page },
      // Header
      h("div", { style: S.header },
        h("div", { style: S.headerTitle }, "🧠 Honcho Dashboard"),
      ),
      // Tabs
      h("div", { style: S.tabs },
        tabs.map(function (t) {
          return h(TabBtn, { key: t.id, label: t.label, icon: t.icon, active: tab === t.id, onClick: function () { setTab(t.id); } });
        })
      ),
      // Body
      h("div", { style: S.body }, content)
    );
  }

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("honcho-dashboard", HonchoDashboard);
    console.log("[Honcho Dashboard] Registered successfully");
  } else {
    console.error("[Honcho Dashboard] register function not available");
  }
  } catch(e) { console.error("[Honcho Dashboard] Init error:", e); }
})();
