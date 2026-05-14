# Wusun Link — Lightweight WSS Tunnel for AI Agent Remote Execution

<p align="center">
  <strong>🇸🇬 Brain → WSS Bridge → 🇨🇳 Executor</strong><br>
  <em>AI大脑自动拆解任务 → WSS长连接隧道 → 远程执行器带技能运行 → 结果回收整合</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/cross--NAT-ready-success" alt="Cross-NAT Ready">
  <a href="https://github.com/zhengfly007/wusun-link/releases"><img src="https://img.shields.io/github/v/release/zhengfly007/wusun-link" alt="Release"></a>
</p>

---

## What is Wusun Link?

**一个极简的AI Agent远程执行基础设施层。**

主流AI Agent框架（LangGraph、AutoGPT、CrewAI）都是**单机多进程**架构——大脑和手在同一台机器上。但真实场景需要跨服务器部署：

- ✅ **AI大脑在新加坡**（高性能模型）→ **执行器在上海**（本地化搜索/技能）
- ✅ **大脑在公有云** → **执行器在企业内网**（无需开放公网端口）
- ✅ **执行器主动外连大脑** → 跨NAT / 防火墙穿透

Wusun Link用 **WebSocket Secure + 持久化长连接** 完成了这个闭环。

---

## Architecture

```
User (Feishu / WeChat / CLI)
  │
  ▼ 🇸🇬 Singapore Brain (Hermes Agent)
  │  AI-driven task decomposition → concurrent WSS dispatch
  │
  ▼ 🔗 WSS Bridge (:18806)
  │  Persistent WSS tunnel, cross-NAT bidirectional
  │  Heartbeat + auto-reconnect + Map-based concurrent dispatch
  │
  ▼ 🇨🇳 Shanghai Executor (OpenClaw Gateway)
  │  78+ built-in skills (web search, crawling, code execution...)
  │
  ▼ Results → Brain aggregates, formats, delivers
```

### Key Design Decisions

| Why WSS not... | Reason |
|----------------|--------|
| **gRPC** | gRPC requires server-side port exposure on both ends; WSS one-direction reverse tunnel works behind NAT |
| **RabbitMQ/Kafka** | Need a dedicated message broker deployment; WSS is the broker itself — zero infrastructure |
| **SSH tunnel** | SSH is transport-only, no message routing, no concurrent dispatch, no heartbeat/protocol layer |
| **K8s/Service Mesh** | Way too heavy for a 2-node architecture; a single Node.js process + PM2 is production-grade |

---

## Features

- **🔄 Cross-NAT / Cross-server** — Executor connects outbound; no public IP or port forwarding
- **🧠 AI brain dynamic decomposition** — Not YAML templates; LLM analyzes and shards tasks in real time
- **⚡ Concurrent execution** — Multiple sub-tasks fire simultaneously over one WSS connection; total time ≈ slowest sub-task
- **🔧 Executor with skills** — Remote side runs OpenClaw Gateway with 78+ pluggable skills
- **💚 Self-healing** — Error classification + auto-retry + timeout degradation
- **📦 One-command ops** — `bash wusn-deploy.sh check|fix|restart|deploy`
- **🔐 WSS encryption** — TLS-secured WebSocket, no plaintext over the wire

---

## Quick Start

### Prerequisites

- Node.js 18+
- Two servers (brain side + executor side)
- OpenClaw Gateway on the executor side

### 1. Clone & Configure

```bash
git clone https://github.com/zhengfly007/wusun-link.git
cd wusun-link
cp .env.example .env
# Edit .env with your server info and API keys
```

### 2. Brain Side (Singapore)

```bash
node wss-server.js
# Or PM2 for production:
pm2 start wss-server.js --name wusn-bridge
```

### 3. Executor Side (Shanghai)

```bash
node wss-client.js
# Or PM2:
pm2 start wss-client.js --name wusn-executor
```

### 4. Verify

```bash
bash wusn-deploy.sh check
```

---

## Components

| File | Purpose |
|------|---------|
| `wss-server.js` | WSS Bridge server — listens, task dispatch, Map-based concurrent routing |
| `wss-client.js` | WSS Bridge client — outbound connect → Gateway WS protocol → skill execution |
| `wusn-deploy.sh` | Ops swiss army knife — `check\|fix\|restart\|deploy` |

---

## Use Cases

- **🌏 Cross-region AI deployment** — Brain in highest-performance region, executor where data lives
- **🏢 Enterprise firewall bypass** — Executor inside corp network connects outbound; no DMZ needed
- **🔄 Hot-standby executor pool** — Multiple executors connect to one brain for failover
- **🧩 Skill marketplace** — One brain orchestrates executors with specialized skills (search, crawl, analyze, code)

---

## Roadmap

- [ ] Auto-failover: executor pool with health-based routing
- [ ] Encrypted task payload with per-task keys
- [ ] Web dashboard: real-time WSS bridge monitoring
- [ ] Plugin system for executor skill discovery

---

## License

MIT — free for any use, commercial or personal.

---

<p align="center">
  <sub>Built with ❤️ for the cross-border AI agent era</sub>
</p>
