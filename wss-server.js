#!/usr/bin/env node
/**
 * 新加坡 WSS Bridge Server v4 — Map集中派发 + 心跳加固版
 * 
 * 监听 0.0.0.0:18806，接受上海 WSS Client 主动连接。
 * 上海作为 executor，Hermes 发来的 task 转发给上海。
 * 
 * v4 改进（2026-05-04）：
 * - 移除 forwardTask + exec.on('message') 监听器泄漏方案
 * - 改用 Map<taskId, callback> 集中派发，零泄漏，天然支持并发
 * - executor断开时清理所有pending任务
 * 
 * 加固项：
 * 1. WebSocket ping/pong 心跳（每30s），连续3次无pong判定死连
 * 2. executor引用校验：发送前检查readyState
 * 3. 新executor连接时清理旧引用
 */

const WebSocket = require('/home/agentuser/node_modules/ws');
const WS_PORT = parseInt(process.env.WSS_PORT || "18806");
const WS_HOST = process.env.WSS_HOST || "0.0.0.0";
const RESPONSE_TIMEOUT = parseInt(process.env.WSS_TIMEOUT || "300000"); // 5 min
const PING_INTERVAL = 30000;     // 30s
const PING_TIMEOUT = 90000;      // 连续3次无响应判定死连

let executor = null;
const pending = new Map(); // taskId -> { timer }

const wss = new WebSocket.Server({ port: WS_PORT, host: WS_HOST });
log('[WSS] Listening on ' + WS_HOST + ':' + WS_PORT + ' (v4 Map dispatch)');

// 心跳检测
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

  // 上海executor
  if (process.env.SH_EXECUTOR_IP || "::ffff:127.0.0.1") {
    // 如果已有旧executor，清理它
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

  // === WebSocket ping/pong 心跳 ===
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
      // === Executor返回的结果 — 通过pending Map派发 ===
      const entry = pending.get(msg.taskId);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(msg.taskId);
        // 找到等待这个taskId的commander，把结果转发过去
        // 注意：commander引用存在msg里（发送时注入）
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

    // === Commander发来的新任务 ===
    const tid = msg.taskId || 'unknown';
    if (!executor || executor.readyState !== WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'result', taskId: tid, success: false, error: 'No executor connected' }));
      return;
    }

    log('[WSS] Forwarding task ' + tid + ' to Shanghai');

    // 用Map注册等待器，保存commander引用用于回调
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
      // executor断开，所有pending任务都超时
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
