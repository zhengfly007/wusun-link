# Wusun Link — Geo-Routed Dual-Node AI Agent Architecture

<p align="center">
  <strong>🇸🇬 Hermes Brain (Singapore) ←→ 🇨🇳 OpenClaw Executor (Shanghai)</strong><br>
  <em>A production reference for running AI agents across the Great Firewall — not a tutorial, not a plugin, not a comparison article.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/status-production- success" alt="Status: Production">
  <img src="https://img.shields.io/badge/uptime-24%2F7-brightgreen" alt="Uptime: 24/7">
  <img src="https://img.shields.io/badge/cost-%C2%A50~0.005%2Ftransaction-success" alt="Cost: ¥0~0.005/txn">
</p>

---

## Why This Exists

The Great Firewall splits AI capabilities in half:

```
Singapore → OpenAI ✓  Claude ✓  DeepSeek ✓  |  Tencent OCR ✗  Baidu ✗  Doubao ✗
Shanghai  → Tencent OCR ✓  Baidu ✓  Doubao ✓  |  OpenAI ✗  Claude ✗  DeepSeek ✗
```

**Neither node can access everything.** A single-machine AI agent can't serve real workloads that need both overseas reasoning and domestic data processing. You must deploy on both sides and make them talk.

This repository is the **reference implementation** of how we solved it — in production, processing real manufacturing quotes, 24/7 since May 2026.

---

## Architecture

```
Feishu (CEO)
  │
  ▼ 🇸🇬 Singapore — Hermes Agent "Tomato" (Brain)
  │  • Task decomposition & routing decisions
  │  • Overseas API access (DeepSeek, Serper, GitHub)
  │  • Memory & self-evolution loop
  │  • Decides WHAT to do and WHERE to send it
  │
  ├── WSS 18806 ────────────────→  🇨🇳 Shanghai — OpenClaw Gateway "Keen" (Executor)
  ├── SSH Tunnel :18999 ────────→      • 78+ skills, 8 specialized sub-agents
  └── Gateway WS direct ────────→      • Domestic API access (Tencent OCR, Baidu, Doubao)
                                         • Local file processing, DXF parsing
                                         • Self-closing pipeline (95% autonomous)
                                            │
                                            ▼
                                    Manufacturing Quote Pipeline
                                    Email → DXF Parse → Engine → Quote → Bitable → Feishu
```

### Resource Routing (Brain-Decided, Not Hardcoded)

| Resource | Node | Why |
|:---------|:----:|:----|
| Overseas models (DeepSeek, Claude) | SG | Can exit GFW |
| Web search (Serper, Tavily) | SG | Global index |
| Tencent OCR, Baidu Search | SH | Domestic latency <5ms |
| Doubao Vision, Seedream images | SH | China-only API |
| Large files (DXF, PDF) | SH | Process locally, don't ship over WSS |
| GitHub, OpenRouter | SG | Oversea accessible |

---

## Three Communication Layers

Not one protocol — three, each with a different job:

| Layer | Channel | Latency | Purpose |
|:---|:---|:---:|:---|
| **Command** | WSS 18806 (WebSocket) | 6ms shell / 1500ms LLM | Task dispatch + result return. Text only, no files. |
| **Repair** | SSH Tunnel (ControlMaster) | 164ms | Bypass WSS client when it crashes. Direct Gateway WS access. |
| **Direct** | Gateway WS (Python client) | 3-17s | Brain talks directly to executor agents. Full tool/skill access. |

### Fallback Chain (4 Layers)

```
1. Gateway WS direct (SSH tunnel :18999)  →  Fastest, full agent capability
2. WSS collect + bare_glm.py              →  LLM Q&A, no tools
3. Feishu Doc channel (keen_worker.py)    →  Cold standby, 1s polling
4. Manual SSH                             →  Last resort
```

Each layer fails independently. The brain detects failure and steps down automatically.

---

## Business Validation: Manufacturing Quote Pipeline

This isn't a demo. It processes real emails with CAD drawings and turns them into priced quotes:

```
Customer Email (zhenhongfly@sohu.com)
  │
  ▼ IMAP detection (no_agent cron, ¥0, <3s)
  │
  ▼ Attachment Download (DXF + XLSX)
  │
  ▼ Classification Router
  ├── Yidu2026      → Engine B: Price table lookup (¥0/txn)
  ├── anestoflife2026 → Engine C: DXF text extraction → fuzzy match → formula (¥0.001/txn)
  └── CMF2026/MAG2026 → Engine A: Vision recognition → pro model (¥0.005/txn, 待样本)
  │
  ▼ Quote Generation
  │  • 243 mapping rules across 12 projects
  │  • DXF dimension extraction with P50/P90 percentile filtering
  │  • Cross-validation with XLSX when available
  │
  ▼ Bitable Archive + Feishu Notification
     • Interactive card: [Confirm Quote] [View Details] [Flag Anomaly]
     • 95% self-closing. Only escalates to human on new project types or <60% coverage.
```

**Real calibration data:** DXF-only estimate ¥53,173 vs actual XLSX ¥56,320 — deviation **-5.6%**.

---

## WSS Bridge — The Transport Layer

For those interested in just the WSS component:

```
Brain (SG)                    Executor (SH)
wss-server.js :18806    ←←←    wss-client.js (outbound connect)
  │                              │
  │  Map<taskId, callback>       │  type=collect → execSync shell
  │  Concurrent dispatch         │  type=default → Gateway WS agent
  │  Circuit breaker (3s OPEN)   │  Exponential backoff reconnect
  │                              │
  └──────── bidirectional ───────┘
```

### Why WSS (not gRPC, not Kafka, not SSH alone)

| Alternative | Problem |
|:---|:---|
| gRPC | Requires port exposure on both ends. WSS reverse-tunnel works behind NAT. |
| Kafka/RabbitMQ | Dedicated broker deployment. WSS is the broker — zero infrastructure. |
| SSH alone | Transport only. No message routing, concurrent dispatch, heartbeat, protocol layer. |
| K8s/Service Mesh | For 2 nodes? A single Node.js process + systemd is production-grade. |

### Client.js Simplification — The Evolution Story

Our original WSS client was **591 lines** with Gateway routing logic (TYPE_AGENT_MAP, fallback chains, batch mode). After building the direct Gateway WS client, we stripped it to **123 lines** — pure collect executor:

| Metric | Before (v7) | After (v8) |
|:---|---:|---:|
| Lines of code | 591 | 123 (-79%) |
| Gateway dependency | Tight coupling | **Zero** |
| PM2 restarts (historical) | 48 | 0 (reset) |
| Maintenance surface | Routing maps, fallback chains, agent timeouts | collect executor only |

The lesson: **when the brain can talk directly to the executor, the middleman becomes dead weight.** See `docs/COMPARISON.md` for the full evolution.

---

## Reliability Stack

| Component | Mechanism |
|:---|:---|
| **Self-healing** | Bidirectional watchdog (SG↔SH). Each side detects partner failure and auto-recovers. |
| **Crash recovery** | systemd Restart=always (SG), PM2 restart_delay 15s (SH). Gateway crash → auto-revive. |
| **Circuit breaker** | WSS Server: 3 consecutive 120s timeouts → OPEN 5min → HALF_OPEN probe → CLOSE. |
| **SSH multiplex** | ControlMaster auto + ControlPersist 300s. SSH latency 890ms → 164ms (-81%). |
| **No garbage cron** | All recurring jobs are no_agent (zero LLM cost). LLM crons require script guard + user confirmation. |
| **Daily evolution** | Automated retrospective at 01:00 — catches error patterns, updates skill library, prevents repeat mistakes. |

---

## Key Numbers

| Metric | Value |
|:---|:---|
| Pipeline autonomy | 95% self-closing |
| SSH latency improvement | 890ms → 164ms (-81%) |
| Client.js code reduction | 591 → 123 lines (-79%) |
| WSS shell execution | 6ms |
| WSS LLM query | 1500ms |
| Gateway WS agent call | 3-17s |
| Quote error (DXF-only vs actual) | -5.6% |
| Cost per transaction | ¥0 (B-class) ~ ¥0.005 (A-class) |
| Cron jobs | 40+ (all no_agent except 5 agent jobs with user-confirmed prompts) |
| Uptime | 24/7 since May 2026 |

---

## Repository Map

```
wusun-link/
├── wss-server.js          # WSS Bridge server (SG side) — systemd-managed
├── wss-client.js          # WSS Bridge client v8 (SH side) — collect-only, 123 lines
├── wusn-deploy.sh         # Ops: check|fix|restart|deploy
├── docs/
│   └── COMPARISON.md      # Ecosystem positioning — why this vs alternatives
├── scripts/
│   ├── wusun-repo-status.py   # 8-hourly repo activity check
│   └── issue-watcher.py       # GitHub issue → Feishu notification
├── .hermes/               # Hermes Agent skills & config (brain side)
│   └── skills/devops/
│       ├── hermes-wss-full-link/     # WSS full-chain protocol + operations
│       ├── hermes-keen-architecture/ # Dual-node architecture decisions
│       └── openclaw-gateway-ws-protocol/ # Gateway WS protocol reference
└── README.md
```

---

## What This Is NOT

- ❌ **Not a Hermes Agent tutorial** — there are 50+ of those already. This assumes you know what Hermes and OpenClaw are.
- ❌ **Not an OpenClaw plugin** — the executor runs OpenClaw Gateway, but this repo is about the bridge between the two, not extending either.
- ❌ **Not a "Hermes vs OpenClaw" comparison** — we use BOTH. The question isn't "which one" — it's "how do they talk."
- ❌ **Not a generic multi-agent framework** — this is purpose-built for geo-routed dual-node deployment. If you need single-machine multi-agent, Hermes' built-in delegation handles that.

**This is:** a production reference for anyone who needs to run AI agents across the Great Firewall — or any scenario where network topology forces a distributed architecture.

---

## Community Context

The AI agent community in 2026 is still debating "Hermes vs OpenClaw." This repo demonstrates that the real question is different:

> **The Brain + Worker pattern isn't a blog concept — it's deployable infrastructure. The wall didn't give us a choice, so we built the bridge.**

No other open-source project combines:
- Hermes Agent (brain) + OpenClaw Gateway (executor) in production
- Real-time bidirectional communication across GFW
- Manufacturing quote pipeline as business validation
- 4-layer self-healing fallback chain
- 95% autonomous execution with human escalation

See `docs/COMPARISON.md` for a detailed assessment of the ecosystem.

---

## License

MIT — free for any use, commercial or personal.

---

<p align="center">
  <sub>Built because the wall left no choice. Open-sourced so others don't start from zero.</sub>
</p>
