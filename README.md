# Wusn Link

**AI Brain + WSS Bridge + Remote Executor — Cross-server, cross-NAT agent orchestration**

```
User (Feishu/WeChat)
  │
  ▼ 🇸🇬 Singapore Hermes (Brain — DeepSeek)
  │  AI task decomposition → concurrent WSS requests
  │
  ▼ WSS Bridge (:18806)
  │  Persistent long connection, cross-NAT bidirectional
  │  Heartbeat + auto-reconnect + Map-based concurrent dispatch
  │
  ▼ 🇨🇳 Shanghai Keen (Executor — OpenClaw)
  │  78 skills (tavily search / web_fetch / etc.)
  │  Invoked via Gateway WebSocket protocol
  │
  ▼ Results back → Brain aggregates & outputs
```

## Why Wusn Link?

Existing multi-agent orchestration solutions (Hivemind, Orchemist, etc.) are all **local single-machine multi-process** — brain and hands on the same machine. But real-world scenarios demand **cross-server deployment**:

- AI brain in Singapore (high-performance models) + executor in Shanghai (localized search/skills)
- Brain on public cloud, executor inside corporate network
- Executor connects outbound to the brain when public ports can't be opened

Wusn Link fills this gap — **the only known open-source architecture that completes the full loop: brain AI decomposition → WSS cross-NAT persistent connection → remote executor with skills → result aggregation.**

## Architecture Highlights

| Feature | Description |
|---------|-------------|
| **Cross-server, cross-NAT** | Executor connects outbound to brain; no public IP or port forwarding needed |
| **AI brain dynamic decomposition** | Not YAML templates — LLM analyzes and shards tasks in real time |
| **Concurrent execution** | Multi-dimension sub-tasks fire simultaneously; total time ≈ slowest sub-task |
| **Executor with skills** | Remote Keen has 78 skills (tavily, web_fetch, etc.) |
| **Self-healing** | Error classification + auto-retry + timeout degradation |
| **One-command ops** | `bash wusn-deploy.sh check\|fix\|restart` |

## Quick Start

### Prerequisites

- Node.js 18+
- Two servers (brain side + executor side)
- OpenClaw Gateway installed on the executor side

### 1. Configure Environment

```bash
cp .env.example .env
# Edit .env with your server info and API keys
```

### 2. Brain Side (Singapore)

```bash
# Start WSS Server
node wss-server.js
# Or use PM2
pm2 start wss-server.js --name wusn-bridge
```

### 3. Executor Side (Shanghai)

```bash
# Start WSS Client (connects outbound to brain)
node wss-client.js
```

### 4. Verify the Link

```bash
bash wusn-deploy.sh check
```

## Core Components

| File | Purpose |
|------|---------|
| `wss-server.js` | WSS Bridge server — listens, forwards tasks, Map-based concurrent dispatch |
| `wss-client.js` | WSS Bridge client — outbound connect, calls OpenClaw via Gateway WS |
| `wusn-deploy.sh` | Ops script — `check\|fix\|restart\|deploy` |

## Comparison

| Project | Difference from Wusn Link |
|---------|--------------------------|
| Hivemind (89⭐) | Local multi-process orchestration, no WSS cross-server |
| Orchemist (0⭐) | Local YAML pipeline, single-machine |
| openclaw-coding-agent (2⭐) | SSH-based remote executor, no brain orchestration layer |

## License

MIT
