# 无双链路 (Wusn Link)

**AI 大脑 + WSS 长连 + 远程执行器 — 跨服跨 NAT 的 Agent 编排架构**

```
创世纪(飞书/微信)
  │
  ▼ 🇸🇬 新加坡 Hermes（大脑 — DeepSeek）
  │  AI 拆解任务 → 并发发 WSS 请求
  │
  ▼ WSS Bridge (:18806)
  │  持久长连接，跨 NAT 双向通信
  │  心跳检测 + 自动重连 + Map 并发派发
  │
  ▼ 🇨🇳 上海 Keen（执行器 — OpenClaw）
  │  带 78 个技能 (tavily 搜索 / web_fetch 等)
  │  通过 Gateway WS 协议调用
  │
  ▼ 结果回传 → 大脑整合输出
```

## 架构特点

| 特点 | 说明 |
|------|------|
| **跨服跨NAT** | 执行器主动出站连大脑，不需要公网IP或端口映射 |
| **AI大脑动态拆解** | 不是YAML模板，是LLM实时分析并分片任务 |
| **并发执行** | 多维度子任务同时发出，总耗时 ≈ 最慢子任务 |
| **带技能执行器** | 远程Keen自带tavily搜索、web_fetch等78技能 |
| **自愈能力** | 错误分类 + 自动重试 + 超时降级 |
| **一键运维** | `bash wusn-deploy.sh check|fix|restart` |

## 为什么会存在

现有的多Agent编排方案（Hivemind、Orchemist等）都是**本地单机多进程**模式——大脑和手脚在同一台机器上。但现实中有很多场景需要**跨服务器部署**：

- 新加坡AI大脑（高性能模型）+ 上海执行器（本地化搜索/技能）
- 大脑在公有云，执行器在企业内网
- 无法打通公网端口的情况下，让执行器主动出站连大脑

无双链路填补了这个空白。

## 快速开始

### 前置条件

- Node.js 18+
- 两台服务器（大脑端 + 执行器端）
- 执行器端需安装 OpenClaw Gateway

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的服务器信息和API Key
```

### 2. 大脑端（新加坡）

```bash
# 启动 WSS Server
node wss-server.js
# 或使用 PM2 管理
pm2 start wss-server.js --name wusn-bridge
```

### 3. 执行器端（上海）

```bash
# 启动 WSS Client（主动连接大脑）
node wss-client.js
```

### 4. 验证链路

```bash
bash wusn-deploy.sh check
```

## 核心组件

| 文件 | 作用 |
|------|------|
| `wss-server.js` | WSS 桥服务端 — 监听端口，转发任务，Map并发派发 |
| `wss-client.js` | WSS 桥客户端 — 出站连服务端，通过Gateway WS调OpenClaw |
| `wusn-deploy.sh` | 一键运维 — `check|fix|restart|deploy` |
| `sg-router.SKILL.md` | 消息路由规则 — 触发词、并行、自愈策略 |

## 相似项目对比

| 项目 | 与本架构差异 |
|------|------------|
| Hivemind (89⭐) | 本地多进程编排，不走WSS跨服 |
| Orchemist (0⭐) | 本地YAML Pipeline，单机编排 |
| openclaw-coding-agent (2⭐) | SSH远程执行器，但无大脑编排层 |

**无双链路是已知唯一实现「大脑AI拆解 → WSS跨NAT长连 → 远程执行器带技能执行 → 结果回传整合」完整闭环的开源架构。**

## License

MIT
