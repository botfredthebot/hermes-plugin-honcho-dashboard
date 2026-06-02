# 🧠 Honcho Dashboard — Hermes Plugin

A dashboard plugin for [Hermes Agent](https://github.com/nousresearch/hermes-agent) that visualizes your [Honcho](https://github.com/nousresearch/honcho) memory system.

## Features

- **Overview** — Stats: peers, sessions, conclusions, messages. Recent conclusions timeline.
- **Peers** — All peers with conclusion counts. Click to see all conclusions about that peer.
- **Sessions** — All sessions with expandable message lists.
- **Conclusions** — Full list with peer filtering. Each conclusion shows observer → observed, timestamp, and source session. "Jump to Chat" expands the original conversation context.

## Installation

```bash
cd ~/.hermes/plugins/
git clone https://github.com/<you>/hermes-plugin-honcho-dashboard.git honcho-dashboard
hermes dashboard restart
```

## Requirements

- Hermes Agent with dashboard enabled
- Honcho API running at `http://localhost:8000`
- Python `fastapi` (included in Hermes venv)

## License

MIT
