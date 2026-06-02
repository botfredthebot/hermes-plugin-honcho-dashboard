/**
 * Honcho Dashboard — Hermes Dashboard Plugin
 *
 * Four tabs: Overview, Peers, Sessions, Conclusions.
 * Each conclusion links back to its source chat via "Jump to Chat".
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  var React = SDK.React;
  var h = React.createElement;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var useRef = SDK.hooks.useRef;

  var API = "/api/plugins/honcho-dashboard";

  function fetchJSON(url) {
    var token = window.__HERMES_SESSION_TOKEN__ || "";
    var headers = token ? { "X-Session-Token": token } : {};
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

  // ---------------------------------------------------------------------------
  // Tab button
  // ---------------------------------------------------------------------------

  function TabBtn(props) {
    var active = props.active;
    var label = props.label;
    var icon = props.icon;
    var onClick = props.onClick;
    return h(
      "button",
      {
        onClick: onClick,
        style: {
          padding: "8px 16px",
          border: "none",
          borderBottom: active ? "2px solid #58a6ff" : "2px solid transparent",
          background: "transparent",
          color: active ? "#58a6ff" : "#8b949e",
          cursor: "pointer",
          fontSize: "0.88em",
          fontWeight: active ? 600 : 400,
        },
      },
      icon + " " + label
    );
  }

  // ---------------------------------------------------------------------------
  // Overview Tab
  // ---------------------------------------------------------------------------

  function OverviewTab() {
    var _useState = useState(null);
    var data = _useState[0], setData = _useState[1];
    var _useState2 = useState(true);
    var loading = _useState2[0], setLoading = _useState2[1];
    var _useState3 = useState(null);
    var error = _useState3[0], setError = _useState3[1];

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

    var S = {
      grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 32 },
      statCard: {
        background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: "20px",
        textAlign: "center",
      },
      statNumber: { fontSize: "2em", fontWeight: 700, color: "#58a6ff", marginBottom: 4 },
      statLabel: { fontSize: "0.82em", color: "#8b949e" },
      section: { marginBottom: 28 },
      sectionTitle: { fontSize: "1.1em", fontWeight: 600, marginBottom: 12, color: "#c9d1d9" },
      conclusionCard: {
        background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
        padding: "14px 16px", marginBottom: 10,
      },
      conclusionText: { fontSize: "0.88em", lineHeight: 1.5, marginBottom: 6 },
      conclusionMeta: { fontSize: "0.75em", color: "#8b949e" },
    };

    return h("div", null,
      h("div", { style: S.grid },
        h("div", { style: S.statCard },
          h("div", { style: S.statNumber }, String(data.peers.total)),
          h("div", { style: S.statLabel }, "Peers")
        ),
        h("div", { style: S.statCard },
          h("div", { style: S.statNumber }, String(data.sessions.total)),
          h("div", { style: S.statLabel }, "Sessions")
        ),
        h("div", { style: S.statCard },
          h("div", { style: S.statNumber }, String(data.conclusions.total)),
          h("div", { style: S.statLabel }, "Conclusions")
        ),
        h("div", { style: S.statCard },
          h("div", { style: S.statNumber }, String(data.messages_sampled)),
          h("div", { style: S.statLabel }, "Messages (sampled)")
        ),
      ),

      h("div", { style: S.section },
        h("div", { style: S.sectionTitle }, "📜 Recent Conclusions"),
        data.conclusions.recent && data.conclusions.recent.length > 0
          ? data.conclusions.recent.map(function (c, i) {
              return h("div", { key: c.id || String(i), style: S.conclusionCard },
                h("div", { style: S.conclusionText }, c.content || ""),
                h("div", { style: S.conclusionMeta },
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
    var _useState = useState([]);
    var peers = _useState[0], setPeers = _useState[1];
    var _useState2 = useState(true);
    var loading = _useState2[0], setLoading = _useState2[1];
    var _useState3 = useState(null);
    var selectedPeer = _useState3[0], setSelectedPeer = _useState3[1];

    useEffect(function () {
      fetchJSON(API + "/peers")
        .then(function (d) { setPeers(d.peers || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, []);

    var S = { card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }, name: { fontWeight: 600, fontSize: "0.95em", marginBottom: 4 }, meta: { fontSize: "0.78em", color: "#8b949e" } };

    return h("div", null,
      h("div", { style: { display: "flex", gap: 24 } },
        h("div", { style: { flex: "0 0 340px", overflowY: "auto", maxHeight: "calc(100vh - 200px)" } },
          loading
            ? h("div", { style: { color: "#8b949e" } }, "Loading…")
            : peers.map(function (p) {
                return h("div", {
                    key: p.id,
                    style: Object.assign({}, S.card, { border: selectedPeer === p.id ? "1px solid #58a6ff" : "1px solid #30363d" }),
                    onClick: function () { setSelectedPeer(selectedPeer === p.id ? null : p.id); },
                  },
                  h("div", { style: S.name }, p.metadata && p.metadata.name ? p.metadata.name : p.id),
                  h("div", { style: S.meta },
                    "Conclusions about: ", h("strong", null, String(p.conclusions_about || 0)),
                    " · By: ", h("strong", null, String(p.conclusions_by || 0))
                  )
                );
              })
        ),
        h("div", { style: { flex: 1, overflowY: "auto", maxHeight: "calc(100vh - 200px)" } },
          selectedPeer
            ? h(PeerDetail, { peerId: selectedPeer })
            : h("div", { style: { color: "#8b949e", padding: 40, textAlign: "center" } }, "Select a peer to view details")
        )
      )
    );
  }

  function PeerDetail(props) {
    var peerId = props.peerId;
    var _useState = useState(null);
    var data = _useState[0], setData = _useState[1];
    var _useState2 = useState(true);
    var loading = _useState2[0], setLoading = _useState2[1];

    useEffect(function () {
      setLoading(true);
      fetchJSON(API + "/conclusions?observed_id=" + encodeURIComponent(peerId) + "&limit=100")
        .then(function (d) { setData(d); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, [peerId]);

    if (loading) return h("div", { style: { color: "#8b949e", padding: 20 } }, "Loading conclusions…");
    if (!data) return null;

    var items = data.items || [];
    return h("div", null,
      h("h3", { style: { marginBottom: 16 } }, "Conclusions about ", h("code", null, peerId)),
      items.length === 0
        ? h("div", { style: { color: "#8b949e" } }, "No conclusions yet.")
        : items.map(function (c, i) {
            return h(ConclusionCard, { key: c.id || String(i), conclusion: c });
          })
    );
  }

  // ---------------------------------------------------------------------------
  // Sessions Tab
  // ---------------------------------------------------------------------------

  function SessionsTab() {
    var _useState = useState([]);
    var sessions = _useState[0], setSessions = _useState[1];
    var _useState2 = useState(true);
    var loading = _useState2[0], setLoading = _useState2[1];
    var _useState3 = useState(null);
    var expanded = _useState3[0], setExpanded = _useState3[1];

    useEffect(function () {
      fetchJSON(API + "/sessions")
        .then(function (d) { setSessions(d.sessions || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, []);

    var S = { card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "14px 16px", marginBottom: 8, cursor: "pointer" }, id: { fontFamily: "monospace", fontSize: "0.85em", marginBottom: 4 }, meta: { fontSize: "0.75em", color: "#8b949e" } };

    return h("div", null,
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Loading…")
        : sessions.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No sessions found.")
        : sessions.map(function (s) {
            return h("div", null,
              h("div", {
                  key: s.id,
                  style: S.card,
                  onClick: function () { setExpanded(expanded === s.id ? null : s.id); },
                },
                h("div", { style: S.id }, s.id),
                h("div", { style: S.meta },
                  "Created: " + timeAgo(s.created_at) + (s.is_active ? " · Active" : "")
                )
              ),
              expanded === s.id ? h(SessionMessages, { sessionId: s.id }) : null
            );
          })
    );
  }

  function SessionMessages(props) {
    var sessionId = props.sessionId;
    var _useState = useState(null);
    var data = _useState[0], setData = _useState[1];
    var _useState2 = useState(true);
    var loading = _useState2[0], setLoading = _useState2[1];

    useEffect(function () {
      fetchJSON(API + "/session/" + encodeURIComponent(sessionId) + "/messages?limit=50")
        .then(function (d) { setData(d); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, [sessionId]);

    if (loading) return h("div", { style: { padding: "12px 16px", color: "#8b949e", fontSize: "0.82em" } }, "Loading messages…");
    if (!data) return null;

    var items = data.items || [];
    return h("div", { style: { margin: "0 0 12px 16px", borderLeft: "2px solid #30363d", paddingLeft: 12 } },
      items.length === 0
        ? h("div", { style: { color: "#8b949e", fontSize: "0.82em", padding: "8px 0" } }, "No messages.")
        : items.map(function (m, i) {
            var peer = m.peer_id || m.from || "?";
            var text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return h("div", { key: m.id || String(i), style: { padding: "6px 0", fontSize: "0.82em", borderBottom: "1px solid #21262d" } },
              h("span", { style: { color: "#58a6ff", marginRight: 8 } }, "[" + peer + "]"),
              h("span", { style: { color: "#c9d1d9" } }, text.slice(0, 200))
            );
          })
    );
  }

  // ---------------------------------------------------------------------------
  // Conclusions Tab
  // ---------------------------------------------------------------------------

  function ConclusionsTab() {
    var _useState = useState([]);
    var conclusions = _useState[0], setData = _useState[1];
    var _useState2 = useState(true);
    var loading = _useState2[0], setLoading = _useState2[1];
    var _useState3 = useState("");
    var filter = _useState3[0], setFilter = _useState3[1];

    useEffect(function () {
      var url = API + "/conclusions?limit=100";
      if (filter) url += "&observed_id=" + encodeURIComponent(filter);
      fetchJSON(url)
        .then(function (d) { setData(d.items || []); })
        .catch(function () {})
        .finally(function () { setLoading(false); });
    }, [filter]);

    return h("div", null,
      h("div", { style: { marginBottom: 16 } },
        h("input", {
          style: { padding: "6px 12px", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#c9d1d9", fontSize: "0.85em", width: "300px" },
          placeholder: "Filter by peer ID…",
          value: filter,
          onChange: function (e) { setFilter(e.target.value); },
        })
      ),
      loading
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "Loading…")
        : conclusions.length === 0
        ? h("div", { style: { color: "#8b949e", padding: 40 } }, "No conclusions found.")
        : conclusions.map(function (c, i) { return h(ConclusionCard, { key: c.id || String(i), conclusion: c }); })
    );
  }

  // ---------------------------------------------------------------------------
  // Conclusion Card (shared)
  // ---------------------------------------------------------------------------

  function ConclusionCard(props) {
    var c = props.conclusion;
    var _useState = useState(false);
    var expanded = _useState[0], setExpanded = _useState[1];

    return h("div", {
        style: {
          background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
          padding: "14px 16px", marginBottom: 10,
        }
      },
      h("div", { style: { fontSize: "0.88em", lineHeight: 1.5, marginBottom: 8 } }, c.content || ""),
      h("div", { style: { fontSize: "0.75em", color: "#8b949e", display: "flex", justifyContent: "space-between", alignItems: "center" } },
        h("span", null,
          (c.observer_id || "?") + " → " + (c.observed_id || "?") + " · " + timeAgo(c.created_at)
        ),
        c.session_id
          ? h("button", {
              onClick: function () { setExpanded(!expanded); },
              style: { background: "none", border: "1px solid #30363d", borderRadius: 4, color: "#58a6ff", cursor: "pointer", fontSize: "0.75em", padding: "2px 8px" },
            }, expanded ? "Hide Source" : "Jump to Chat")
          : null
      ),
      expanded && c.session_id
        ? h(SessionMessages, { sessionId: c.session_id })
        : null
    );
  }

  // ---------------------------------------------------------------------------
  // Main Component
  // ---------------------------------------------------------------------------

  function HonchoDashboard() {
    var _useState = useState("overview");
    var tab = _useState[0], setTab = _useState[1];

    var tabs = [
      { id: "overview", label: "Overview", icon: "📊" },
      { id: "peers", label: "Peers", icon: "👤" },
      { id: "sessions", label: "Sessions", icon: "💬" },
      { id: "conclusions", label: "Conclusions", icon: "🧠" },
    ];

    var content;
    if (tab === "overview") content = h(OverviewTab);
    else if (tab === "peers") content = h(PeersTab);
    else if (tab === "sessions") content = h(SessionsTab);
    else if (tab === "conclusions") content = h(ConclusionsTab);

    return h("div", { style: { height: "100%", display: "flex", flexDirection: "column" } },
      h("div", { style: { display: "flex", borderBottom: "1px solid #30363d", padding: "0 24px", gap: 4 } },
        tabs.map(function (t) {
          return h(TabBtn, { key: t.id, label: t.label, icon: t.icon, active: tab === t.id, onClick: function () { setTab(t.id); } });
        })
      ),
      h("div", { style: { flex: 1, overflowY: "auto", padding: "24px", background: "#0d1117" } },
        content
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("honcho-dashboard", HonchoDashboard);
  }
})();
