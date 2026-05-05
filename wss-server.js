#!/usr/bin/env node
/**
 * WSS Bridge Server v4 — Map dispatch + hardened heartbeat
 * 
 * Listens on 0.0.0.0:18806, accepts Shanghai WSS Client connections.
 * Shanghai acts as executor; tasks from Hermes are forwarded to Shanghai.
 * 
 * v4 improvements (2026-05-04):
 * - Removed forwardTask + exec.on('message') listener leak approach
 * - Switched to Map<taskId, callback> centralized dispatch — zero leak, native concurrency
 * - Clean up all pending tasks when executor disconnects
 * 
 * Hardening:
 * 1. WebSocket ping/pong heartbeat (every 30s), 3 consecutive missed pongs = dead connection
 * 2. Executor reference validation: check readyState before sending
 * 3. Clean up old executor reference when new one connects
 */

const WebSocket = require('ws');
const WS_PORT = parseInt(process.env.WSS_PORT || "18806");
const WS_HOST = process.env.WSS_HOST || "0.0.0.0";
const RESPONSE_TIMEOUT = parseInt(process.env.WSS_TIMEOUT || "300000"); // 5 min
const PING_INTERVAL = 30000;     // 30s
const PING_TIMEOUT = 90000;     // 3 consecutive missed pongs = dead connection

let executor = null;
const pending = new Map(); // taskId -> { timer }

const wss = new WebSocket.Server({ port: WS_PORT, host: WS_HOST });
log('[WSS] Listening on ' + WS_HOST + ':' + WS_PORT + ' (v4 Map dispatch)');

  // Heartbeat check
setInterval(() => {
  log('[WSS] Heartbeat — executor: ' + (executor ? 'connected' : 'disconnected'));
  if (executor && executor.readyState !== WebSocket.OPEN) {
    log('[WSS] Executor socket not OPEN, clearing');
    executor = null;
  }
}, 60000);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  log('[WSS] Connection from ' + ip);

  // Shanghai executor
  if (process.env.SH_EXECUTOR_IP || "::ffff:127.0.0.1") {
    // If old executor exists, clean it up
    if (executor && executor !== ws) {
      try { executor.terminate(); } catch(e) {}
      log('[WSS] Old executor replaced');
    }
    executor = ws;
    log('[WSS] Shanghai executor connected');
    ws.send(JSON.stringify({ type: 'welcome', role: 'executor' }));
  } else {
    log('[WSS] Client connected (commander)');
    ws.send(JSON.stringify({ type: 'welcome', role: 'commander' }));
  }

  // === WebSocket ping/pong heartbeat ===
  let alive = true;
  let pingFailCount = 0;
  const pingTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(pingTimer);
      return;
    }
    pingFailCount++;
    if (pingFailCount >= 3) {
      log('[WSS] Ping timeout — terminating dead socket');
      clearInterval(pingTimer);
      ws.terminate();
      return;
    }
    ws.ping();
  }, PING_INTERVAL);

  ws.on('pong', () => {
    pingFailCount = 0;
    alive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch(e) { return; }

    if (ws === executor) {
      // === Executor result — dispatch via pending Map ===
      const entry = pending.get(msg.taskId);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(msg.taskId);
        // Find the commander waiting for this taskId and forward the result
        // Note: commander reference is stored in msg (injected at send time)
        if (entry.commander && entry.commander.readyState === WebSocket.OPEN) {
          entry.commander.send(JSON.stringify(msg));
          log('[WSS] Result for ' + msg.taskId + ' dispatched');
        } else {
          log('[WSS] Result for ' + msg.taskId + ' dropped (commander disconnected)');
        }
      } else {
        log('[WSS] Orphan result: ' + msg.taskId + ' (no waiter)');
      }
      return;
    }

    // === Commander sends new task ===
    const tid = msg.taskId || 'unknown';
    if (!executor || executor.readyState !== WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'result', taskId: tid, success: false, error: 'No executor connected' }));
      return;
    }

    log('[WSS] Forwarding task ' + tid + ' to Shanghai');

    // Register waiter in Map, save commander reference for callback
    const timer = setTimeout(() => {
      const entry = pending.get(tid);
      if (entry) {
        pending.delete(tid);
        if (entry.commander && entry.commander.readyState === WebSocket.OPEN) {
          entry.commander.send(JSON.stringify({ type: 'result', taskId: tid, success: false, error: 'Timeout (' + RESPONSE_TIMEOUT/1000 + 's)' }));
        }
      }
    }, RESPONSE_TIMEOUT);

    pending.set(tid, { timer, commander: ws });
    executor.send(JSON.stringify(msg));
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    if (ws === executor) {
      executor = null;
      log('[WSS] Executor disconnected — clearing ' + pending.size + ' pending tasks');
      // executor disconnects, all pending tasks time out
      for (const [tid, entry] of pending) {
        clearTimeout(entry.timer);
        if (entry.commander && entry.commander.readyState === WebSocket.OPEN) {
          entry.commander.send(JSON.stringify({ type: 'result', taskId: tid, success: false, error: 'Executor disconnected' }));
        }
      }
      pending.clear();
    }
  });

  ws.on('error', (err) => {
    log('[WSS] Error: ' + err.message);
    clearInterval(pingTimer);
  });
});

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stdout.write('[' + ts + '] ' + msg + '\n');
}
