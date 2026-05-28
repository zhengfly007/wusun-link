# Wusun Link in the Ecosystem

> **Positioning vs Hermes Agent, OpenClaw, and OGP (Open Gateway Protocol)**

*Last updated: 2026-05-28*

---

## The Missing Dimension

Every major comparison of AI agent infrastructure frames the choice as **Hermes vs OpenClaw**:

| Source | Perspective |
|--------|-------------|
| [TrilogyAI: Hermes vs OpenClaw](https://trilogyai.substack.com/p/technical-deep-dive-hermes-vs-openclaw) (Apr 2026) | Five-dimension technical decomposition |
| [Sau Sheong: Dissecting OpenClaw](https://sausheong.com/dissecting-openclaw-733213e9c853) (Apr 2026) | OpenClaw system design deep dive |
| [HN Discussion](https://news.ycombinator.com/item?id=47644400) (2026) | Community discourse on both frameworks |
| [Reddit: OpenClaw vs Hermes](https://www.reddit.com/r/openclaw/comments/1swc620/openclaw_vs_hermes/) | User migration experiences |

**All of them share the same blind spot:** they assume the brain and executor sit on the same machine or at least in the same geographic region.

**Wusun Link exists specifically for the scenario no one else covers:** cross-region, cross-NAT, brain-in-one-cloud-executor-in-another.

---

## Where Wusun Link Sits

```
Other Frameworks:         Hermes Agent or OpenClaw (single-machine)
                                │
                        ┌───────┴───────┐
                        │  Gateway/Loop │
                        │  + Models     │
                        │  + Memory     │
                        │  + Skills     │
                        └───────────────┘

Wusun Link Architecture:  Hermes Agent  ←WSS→  OpenClaw Executor
                         (Singapore)   :18806  (Shanghai)
                              │                   │
                          Fast models        Local resources
                          Global APIs        Domestic APIs
                          Memory/Brain       Skills/Execution
```

Wusun Link is **not** an alternative to either Hermes or OpenClaw. It is the **connective tissue** that lets you use both — each for what it does best — across geographic and network boundaries.

---

## Dimension-by-Dimension Comparison

Based on the [TrilogyAI five-dimension framework](https://trilogyai.substack.com/p/technical-deep-dive-hermes-vs-openclaw):

### 1. Runtime & Language

| | OpenClaw | Hermes | Wusun Link |
|---|----------|--------|------------|
| Language | Node.js | Python 3.11 | **Node.js** (WSS bridge) |
| Core abstraction | Gateway daemon | AIAgent loop (run_agent.py) | **WSS tunnel** (persistent bidirectional) |
| Execution model | Local/SSH/Docker | 6 backends incl. serverless | **Remote relay** — inherits executor's backend |

**Wusun Link's position:** Language-agnostic bridge. The brain side (Hermes/Python) talks WSS to the executor side (OpenClaw/Node.js). Neither needs to know the other's runtime.

### 2. Memory & Persistence

| | OpenClaw | Hermes | Wusun Link |
|---|----------|--------|------------|
| Memory style | Unbounded Markdown | Bounded + curated | **Not a memory system** — relays instructions only |
| Cross-session | SQLite FTS5 | SQLite FTS5 | **Stateless** (session managed by brain) |
| Auditability | Human-readable files | Tool-call history | **WSS logs record every dispatch** |

**Wusun Link's position:** Pure transport. Zero memory, zero state. All context lives on the brain side. This is deliberate — the bridge should be the simplest possible component so it never becomes a failure point.

### 3. Tool Surface & Skills

| | OpenClaw | Hermes | Wusun Link |
|---|----------|--------|------------|
| Built-in tools | Skill-based (SKILL.md) + MCP | 48 tools across 40 toolsets | **0 tools** — pure dispatch |
| Skill format | agentskills.io SKILL.md | agentskills.io SKILL.md | **Compatible** — passes skill instructions verbatim |
| Execution security | Approval system | Dangerous command detection | **Inherits executor's security model** |

**Wusun Link's position:** The bridge doesn't filter or modify instructions. Security is the responsibility of each end. The brain vets what it dispatches; the executor enforces what it runs.

### 4. Execution Environments

| | OpenClaw | Hermes | Wusun Link |
|---|----------|--------|------------|
| Local | ✅ | ✅ | **✅** (relays to local executor) |
| SSH | Via exec | Native backend | **✅** (executor can be SSH-initiated) |
| Docker | Via exec | Native backend | **✅** (executor can be containerized) |
| Serverless | No | Daytona + Modal | **N/A** (executor's problem) |
| **Cross-NAT** | ❌ | ❌ | **✅** — executor connects out to brain |
| **Cross-region** | ❌ | ❌ | **✅** — purpose-built for this |

**Wusun Link's position:** The only option when your AI brain and executor are in different countries, behind different firewalls, or separated by NAT.

### 5. Channel & Platform Coverage

| | OpenClaw | Hermes | Wusun Link |
|---|----------|--------|------------|
| Messaging channels | 22 (incl. iMessage, IRC, LINE, Zalo) | 13 (incl. DingTalk, Feishu, WeCom) | **None** — not a messaging platform |
| Multi-agent routing | Named agents per channel | Profiles (isolated per agent) | **Multi-brain aware** — concurrent dispatch |
| Federation | OGP sidecar | OGP compatible | **Pre-dates OGP federation** with WSS |

**Wusun Link's position:** Not a user-facing channel. It is a **server-to-server protocol** that sits behind whichever channels the brain exposes.

---

## Wusun Link vs OGP (Open Gateway Protocol)

OGP is a federation layer that lets agents on different frameworks exchange signed messages. Wusun Link addresses a different problem:

| | OGP | Wusun Link |
|---|-----|------------|
| **What it solves** | Cross-framework message exchange | **Cross-region remote execution** |
| **Transport** | Signed messages over HTTP | **Persistent WSS tunnel** |
| **Latency** | Higher (HTTP request-response) | **Low** (persistent connection, no TLS handshake per message) |
| **NAT traversal** | Requires public endpoints on both sides | **Executor can initiate connection** — works behind NAT |
| **Reliability** | Standard HTTP retry | **Heartbeat + auto-reconnect** with exponential backoff |
| **Concurrent dispatch** | Per-message, serialized | **Map-based concurrent dispatch** — parallel tasks tracked by ID |
| **Message size** | Signed payload | **Binary-safe** — passes raw data |

**Bottom line:** OGP is a protocol. Wusun Link is a **transport infrastructure layer**. They serve different purposes and can be used together — OGP for cross-framework signaling, Wusun Link for the actual remote execution tunnel.

---

## Where It Fits in Your Stack

```
                    ┌─────────────────────┐
                    │   User (Feishu/CLI) │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Hermes Agent       │  ◄── Brain (routing, memory,
                    │  (Singapore)        │       skill creation, context)
                    └──────────┬──────────┘
                               │
                     ┌────────▼────────┐
                     │  Wusun Link     │  ◄── Bridge (WSS tunnel,
                     │  (:18806)       │       concurrent dispatch,
                     └────────┬────────┘       reconnect)
                               │
                    ┌──────────▼──────────┐
                    │  OpenClaw Executor  │  ◄── Hands (local resources,
                    │  (Shanghai)         │       domestic APIs, skills)
                    └─────────────────────┘
```

### When to use Wusun Link

- ✅ Your AI models are in one region but your compute/resources are in another
- ✅ Your executor is behind NAT or a firewall
- ✅ You want the brain to be model-rich (global) and the executor to be resource-rich (local)
- ✅ You need concurrent task dispatch with per-task result tracking
- ✅ You want the simplest possible bridge — zero infrastructure, zero message broker

### When NOT to use Wusun Link

- ❌ Brain and executor are on the same machine (use a local IPC mechanism)
- ❌ You need full OGP federation with multiple frameworks
- ❌ Your use case fits entirely within a single agent framework's capabilities

---

## References

- [TrilogyAI: Technical Deep Dive — Hermes vs OpenClaw](https://trilogyai.substack.com/p/technical-deep-dive-hermes-vs-openclaw)
- [Sau Sheong: Dissecting OpenClaw](https://sausheong.com/dissecting-openclaw-733213e9c853)
- [Hermes Agent Official Docs](https://hermes-agent.nousresearch.com/docs)
- [OpenClaw Official Site](https://openclaw.ai)
- [OGP — Open Gateway Protocol](https://opengatewayprotocol.dev)
