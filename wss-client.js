#!/usr/bin/env node
/**
 * Hermes-WS Bridge Client v6 — Dual mode: direct deepseek + Gateway WS
 * 
 * Changes:
 * - When request specifies model, auto-route to the matching provider
 * - Added deepseek provider direct call support
 * - Gateway WS (useKeen=true) remains unchanged
 * - Default model changed to deepseek-chat
 */

const fs = require("fs");
const WebSocket = require("ws");
const CONFIG_PATH = process.env.OPENCLAW_CONFIG || "./openclaw.json";
const SG_WS_URL = process.env.SG_WS_URL || "ws://localhost:18806";
const RECONNECT_BASE = 5000;
const RECONNECT_MAX = 30000;

/** Read all provider configs from openclaw.json */
function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const c = JSON.parse(raw);
  const providers = c.models?.providers || {};
  return { providers, gatewayToken: (process.env.GATEWAY_TOKEN || "") };
}

/** Select provider by model name */
function resolveProvider(providers, model) {
  if (!model || model === "tc-code-latest" || model.startsWith("tencentcodingplan/")) {
    const p = providers.tencentcodingplan;
    if (!p) throw Error("no tencentcodingplan provider");
    const modelId = model ? model.replace("tencentcodingplan/", "") : "tc-code-latest";
    return { baseUrl: p.baseUrl || "https://api.lkeap.cloud.tencent.com/coding/v3", apiKey: p.apiKey, model: modelId };
  }
  if (model.startsWith("deepseek/")) {
    const p = providers.deepseek;
    if (!p) throw Error("no deepseek provider in config");
    return { baseUrl: p.baseUrl || "https://api.deepseek.com/v1", apiKey: p.apiKey, model: model.replace("deepseek/", "") };
  }
  // Default to deepseek
  const p = providers.deepseek;
  if (p) return { baseUrl: p.baseUrl || "https://api.deepseek.com/v1", apiKey: p.apiKey, model: "deepseek-chat" };
  // fallback to tencent
  const t = providers.tencentcodingplan;
  if (t) return { baseUrl: t.baseUrl, apiKey: t.apiKey, model: "tc-code-latest" };
  throw Error("no usable provider");
}

async function callAPI(api, msgs) {
  const resp = await fetch(api.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + api.apiKey },
    body: JSON.stringify({ model: api.model, messages: msgs, stream: false, max_tokens: 4096 })
  });
  if (!resp.ok) throw Error("API " + resp.status + ": " + (await resp.text()).slice(0,300));
  return (await resp.json()).choices?.[0]?.message?.content || "(empty)";
}

async function handleTask(task) {
  const { taskId, prompt, systemPrompt, model, useKeen } = task;
  const t0 = Date.now();
  const cfg = loadConfig();

  if (useKeen === true) {
    console.log("[SH] Task " + taskId + " -> Gateway(OpenClaw agent)");
    try {
      const result = await callKeenViaGateway(cfg.gatewayToken, prompt);
      return { type: "result", taskId, success: true, result: result.text, elapsed: Date.now() - t0 };
    } catch(e) {
      console.error("[SH] GW err:", e);
      return { type: "result", taskId, success: false, error: "gateway: " + e };
    }
  }

  const api = resolveProvider(cfg.providers, model);
  console.log("[SH] Task " + taskId + " -> " + api.model + " (" + (prompt||"").slice(0,60) + ")");
  const msgs = [];
  if (systemPrompt) msgs.push({ role: "system", content: systemPrompt });
  msgs.push({ role: "user", content: prompt || "" });
  try {
    const r = await callAPI(api, msgs);
    return { type: "result", taskId, success: true, result: r, elapsed: Date.now() - t0 };
  } catch(e) {
    return { type: "result", taskId, success: false, error: e.message };
  }
}

/** Gateway WS method to call Keen — full protocol: agent + session.message listener */
async function callKeenViaGateway(gwToken, prompt) {
  const GW_WS_URL = "ws://127.0.0.1:18789";
  const t0 = Date.now();
  
  return new Promise((resolve, reject) => {
    let responded = false;
    let gw;
    try { gw = new WebSocket(GW_WS_URL); } catch(e) { return reject("GW connect fail: " + e.message); }
    
    const timeout = setTimeout(() => {
      if (!responded) { responded = true; try { gw.close(); } catch(e){} reject("Gateway timeout (300s)"); }
    }, 300000);
    
    const crypto = require("crypto");
    const idemKey = crypto.randomUUID();
    let collectedText = "";
    
    gw.on("open", () => { console.log("[SH] GW connected"); });
    
    gw.on("message", (raw) => {
      if (responded) return;
      try {
        const msg = JSON.parse(raw.toString());
        
        // Step 1: connect.challenge
        if (msg.type === "event" && msg.event === "connect.challenge") {
          gw.send(JSON.stringify({
            type: "req", id: "1", method: "connect",
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: "gateway-client", version: "1.0.0", platform: "cli", mode: "backend" },
              role: "operator",
              scopes: ["operator.read", "operator.write", "operator.admin"],
              auth: { token: gwToken }
            }
          }));
          console.log("[SH] GW connect sent");
          return;
        }
        
        // Step 2: hello.ok → subscribe + agent
        if (msg.type === "res" && msg.ok && msg.payload?.type === "hello-ok") {
          gw.send(JSON.stringify({
            type: "req", id: "sub", method: "sessions.subscribe",
            params: {}
          }));
          gw.send(JSON.stringify({
            type: "req", id: "2", method: "agent",
            params: {
              message: prompt,
              agentId: "main",
              idempotencyKey: idemKey
            }
          }));
          console.log("[SH] GW agent sent, idem=" + idemKey);
          return;
        }
        
        // agent accepted → send agent.wait
        if (msg.type === "res" && msg.id === "2" && msg.ok) {
          gw.send(JSON.stringify({
            type: "req", id: "3", method: "agent.wait",
            params: { runId: idemKey, timeoutMs: 300000 }
          }));
          return;
        }
        
        // session.message — collect agent reply content
        if (msg.type === "event" && msg.event === "session.message") {
          const m = msg.payload?.message;
          if (m?.role === "assistant" && m?.content) {
            const texts = m.content
              .filter(c => c.type === "text")
              .map(c => c.text)
              .join("");
            if (texts) collectedText = texts;
          }
          return;
        }
        
        // agent.wait returns result
        if (msg.type === "res" && msg.id === "3") {
          if (msg.ok) {
            const status = msg.payload?.status || "unknown";
            if (status === "ok") {
              responded = true; clearTimeout(timeout);
              const result = collectedText || "[Agent completed, no text content]";
              console.log("[SH] GW agent done (" + ((Date.now()-t0)/1000).toFixed(1) + "s)");
              resolve({ text: result, elapsed: Date.now() - t0 });
            } else if (status === "error") {
              responded = true; clearTimeout(timeout);
              reject("GW agent error: " + (msg.payload?.error || "unknown"));
            } else {
              responded = true; clearTimeout(timeout);
              reject("GW agent wait status=" + status);
            }
          } else {
            responded = true; clearTimeout(timeout);
            reject("GW agent.wait error: " + (msg.error?.message || JSON.stringify(msg.error)));
          }
          try { gw.close(); } catch(e){}
          return;
        }
        
        // agent lifecycle events
        if (msg.type === "event" && msg.event === "agent" && msg.payload?.stream === "assistant") {
          const text = msg.payload?.data?.text;
          if (text) collectedText = text;
          return;
        }
        
        // chat final event
        if (msg.type === "event" && msg.event === "chat" && msg.payload?.state === "final") {
          const m = msg.payload?.message;
          if (m?.content) {
            const texts = m.content.filter(c => c.type === "text").map(c => c.text).join("");
            if (texts) collectedText = texts;
          }
          return;
        }
        
        // legacy format compatibility
        if (msg.type === "result" || msg.status === "ok") {
          responded = true; clearTimeout(timeout);
          const text = msg.payloads?.[0]?.text || msg.result || "(empty)";
          resolve({ text, elapsed: Date.now() - t0 });
          return;
        }
        if (msg.type === "error" || msg.error) {
          responded = true; clearTimeout(timeout);
          reject("GW error: " + (msg.error || msg.message || "unknown"));
        }
      } catch(e) {}
    });
    
    gw.on("error", (err) => { if (!responded) { responded = true; clearTimeout(timeout); reject("GW ws error: " + err.message); } });
    gw.on("close", () => { if (!responded) { responded = true; clearTimeout(timeout); reject("Gateway closed without response"); } });
  });
}


let ws = null, reconnTimer = null, reconnAttempt = 0;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  reconnAttempt++;
  console.log("[SH] Connecting to", SG_WS_URL);
  ws = new WebSocket(SG_WS_URL);
  ws.on("open", () => { reconnAttempt = 0; console.log("[SH] Connected to SG"); });
  ws.on("message", async (raw) => {
    let task;
    try { task = JSON.parse(raw.toString()); } catch(e) { return; }
    if (task.type === "welcome") return;
    if (task.type === "ping") { try { ws.send(JSON.stringify({type:"pong"})); } catch(e){} return; }
    const result = await handleTask(task);
    try { ws.send(JSON.stringify(result)); } catch(e) { console.error("[SH] send fail:", e.message); }
  });
  ws.on("ping", () => { try { ws.pong(); } catch(e){} });
  ws.on("close", () => {
    const delay = Math.min(RECONNECT_BASE * Math.pow(1.5, reconnAttempt), RECONNECT_MAX);
    const jitter = Math.random() * 2000;
    console.log("[SH] Disconnected, reconnecting in " + ((delay+jitter)/1000).toFixed(1) + "s");
    ws = null;
    reconnTimer = setTimeout(connect, delay + jitter);
  });
  ws.on("error", (err) => { console.error("[SH] WS err:", err.message); if (ws) { ws.close(); ws = null; } });
}

process.on("SIGINT", () => { clearTimeout(reconnTimer); if(ws) ws.close(); process.exit(0); });
process.on("SIGTERM", () => { clearTimeout(reconnTimer); if(ws) ws.close(); process.exit(0); });

console.log("[SH] Hermes-WS Bridge Client v6 (dual provider)");
console.log("[SH] Target:", SG_WS_URL);
connect();
