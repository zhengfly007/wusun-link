#!/bin/bash
# ============================================================
# Wusn Link — One-click deploy + recovery script
# Usage:
#   bash wusn-deploy.sh check    — Full link inspection
#   bash wusn-deploy.sh status   — Same as check
#   bash wusn-deploy.sh fix      — Auto-repair anomalies
#   bash wusn-deploy.sh restart  — Restart full link
#   bash wusn-deploy.sh deploy   — First-time or re-deploy
# ============================================================
VERSION="1.0.0"
SG_IP="${SG_IP:-your-singapore-server-ip}"
SH_IP="${SH_IP:-your-shanghai-server-ip}"
SSH_PORT="22222"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_USER="${SSH_USER:-your-ssh-user}"
SG_WSS_PORT="18806"
SH_CLIENT_PATH="/opt/hermes-bridge"
SH_GW_WS="127.0.0.1:18789"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()  { echo -e " ${GREEN}✅${NC} $1"; }
warn(){ echo -e " ${YELLOW}⚠️${NC} $1"; }
fail(){ echo -e " ${RED}❌${NC} $1"; }
info(){ echo -e " ${CYAN}ℹ️${NC} $1"; }

# ---- Singapore side ----
sg_status() {
  info "=== Singapore check ==="
  local wss=$(pm2 list 2>/dev/null | grep hermes-wss-bridge)
  if echo "$wss" | grep -q "online"; then
    ok "WSS Server: online"
    echo "$wss" | awk '{print "   uptime:", $10, "restarts:", $9}'
  else
    fail "WSS Server: $(echo "$wss" | awk '{print $NF}')"
  fi

  # Heartbeat check
  local heartbeat=$(pm2 logs hermes-wss-bridge --lines 3 --nostream 2>/dev/null | grep Heartbeat | tail -1)
  if echo "$heartbeat" | grep -q "connected"; then
    ok "Heartbeat: executor connected"
  else
    warn "Heartbeat: $(echo "$heartbeat" | grep -o 'disconnected' || echo 'no heartbeat log')"
  fi

  # WSS port
  if ss -tlnp 2>/dev/null | grep -q ":$SG_WSS_PORT "; then
    ok "Port $SG_WSS_PORT: listening"
  else
    fail "Port $SG_WSS_PORT: not listening"
  fi
}

sg_fix() {
  warn "Attempting to fix Singapore side..."
  local wss_status=$(pm2 list 2>/dev/null | grep hermes-wss-bridge)
  if ! echo "$wss_status" | grep -q "online"; then
    # Check port availability
    local old_pid=$(ss -tlnp 2>/dev/null | grep ":$SG_WSS_PORT " | grep -oP 'pid=\K[0-9]+')
    if [ -n "$old_pid" ]; then
      warn "Port occupied by PID=$old_pid, killing..."
      kill $old_pid 2>/dev/null
      sleep 2
    fi
    pm2 delete hermes-wss-bridge 2>/dev/null
    pm2 start ${SG_WSS_PATH:-./hermes-wss-server.js} --name hermes-wss-bridge
    pm2 save
    ok "WSS Server restarted"
  fi
}

sg_restart() {
  info "Restarting Singapore WSS Server..."
  pm2 restart hermes-wss-bridge
  pm2 save
  ok "WSS Server restarted"
}

# ---- Shanghai side (via SSH) ----
sh_cmd() { ssh -p $SSH_PORT -i $SSH_KEY -o ConnectTimeout=10 -o StrictHostKeyChecking=no $SSH_USER@$SH_IP "$@" 2>/dev/null; }

sh_status() {
  info "=== Shanghai check ==="
  local pm2_out=$(sh_cmd "sudo pm2 list 2>/dev/null | grep hermes-bridge")
  if echo "$pm2_out" | grep -q "hermes-bridge-client.*online"; then
    ok "client.js: online"
    echo "$pm2_out" | awk '{print "   uptime:", $10, "restarts:", $9}'
  else
    if echo "$pm2_out" | grep -q "hermes-bridge-client"; then
      fail "client.js: $(echo "$pm2_out" | grep hermes-bridge-client | awk '{print $NF}')"
    else
      fail "client.js: no PM2 process found"
    fi
  fi

  # server.js status
  if echo "$pm2_out" | grep -q "hermes-bridge.*online"; then
    ok "server.js: online"
  else
    warn "server.js: $(echo "$pm2_out" | grep hermes-bridge | grep -v client | awk '{print $NF}')"
  fi

  # Recent client log
  local log=$(sh_cmd "sudo tail -3 \${SH_PM2_LOG:-/root/.pm2/logs/hermes-bridge-client-out.log} 2>/dev/null | grep -E 'Connected|Welcome|GW'")
  if [ -n "$log" ]; then
    ok "Recent log: $(echo "$log" | head -1)"
  else
    warn "No recent log entries"
  fi

  # Gateway process
  local gw_pid=$(sh_cmd "pgrep -f openclaw-gateway 2>/dev/null")
  if [ -n "$gw_pid" ]; then
    ok "OpenClaw Gateway: running (PID=$gw_pid)"
  else
    fail "OpenClaw Gateway: process not found"
  fi
}

sh_fix() {
  warn "Attempting to fix Shanghai side..."
  local pm2_out=$(sh_cmd "sudo pm2 list 2>/dev/null | grep hermes-bridge-client")
  if ! echo "$pm2_out" | grep -q "online"; then
    sh_cmd "sudo pm2 restart hermes-bridge-client 2>/dev/null && echo OK" | grep -q "OK" && ok "client.js restarted" || warn "client.js restart failed"
  fi
  # Check Gateway
  local gw_pid=$(sh_cmd "pgrep -f openclaw-gateway 2>/dev/null")
  if [ -z "$gw_pid" ]; then
    warn "Gateway not running, attempting to start..."
    sh_cmd "sudo systemctl restart openclaw-gateway 2>/dev/null; sleep 3; pgrep -f openclaw-gateway" | grep -qE '^[0-9]+$' && ok "Gateway started" || fail "Gateway failed to start"
  fi
}

sh_restart() {
  info "Restarting Shanghai side..."
  sh_cmd "sudo pm2 restart hermes-bridge-client && sudo pm2 restart hermes-bridge"
  ok "Shanghai side restarted"
}

# ---- Full link test ----
link_test() {
  info "=== Full link test ==="
  local script="/tmp/wusn_deploy_test_$$.js"
  cat > $script << 'JSEOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:18806');
const t0 = Date.now();
let done = false;
ws.on('open', () => { ws.send(JSON.stringify({taskId:'deploy_test_'+Date.now(), prompt:'Reply OK within 10 chars', useKeen:true})); });
ws.on('message', r => {
  if (done) return;
  try {
    const d = JSON.parse(r.toString());
    if (d.type === 'welcome') return;
    done = true;
    if (d.success) console.log('OK:' + (Date.now()-t0) + 'ms:' + (d.result||'').substring(0,30));
    else console.log('FAIL:' + (d.error||'unknown'));
    ws.close();
  } catch(e) {}
});
setTimeout(() => { if (!done) { done = true; console.log('TIMEOUT'); ws.close(); } }, 90000);
JSEOF
  local result=$(node $script 2>&1)
  rm -f $script
  if echo "$result" | grep -q "^OK:"; then
    ok "Full link: $(echo "$result" | head -1)"
  else
    fail "Full link: $result"
  fi
}

# ---- Main logic ----
case "${1:-check}" in
  check|status)
    sg_status
    echo
    sh_status
    echo
    link_test
    ;;
  fix)
    sg_fix
    sh_fix
    echo
    sleep 5
    link_test
    ;;
  restart)
    sg_restart
    sh_restart
    echo
    sleep 5
    link_test
    ;;
  deploy)
    info "First-time deploy guide:"
    echo "  Singapore side:"
    echo "    pm2 start ${SG_WSS_PATH:-./hermes-wss-server.js} --name hermes-wss-bridge"
    echo "    pm2 save"
    echo "    Shanghai side (manual or remote):"
    echo "    ssh -p $SSH_PORT -i $SSH_KEY $SSH_USER@$SH_IP 'sudo pm2 start $SH_CLIENT_PATH/client.js --name hermes-bridge-client'"
    echo ""
    info "Or if already deployed, run deploy to auto-complete:"
    sg_fix
    sh_fix
    echo
    link_test
    ;;
  *)
    echo "Usage: bash wusn-deploy.sh [check|fix|restart|deploy]"
    echo "  check     Full link inspection"
    echo "  fix       Auto-repair anomalies"
    echo "  restart   Restart full link"
    echo "  deploy    First-time or re-deploy"
    ;;
esac
