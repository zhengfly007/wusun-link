#!/bin/bash
# ============================================================
# 无双链路 一键部署+恢复脚本
# 适用：新加坡(43.156.186.237) + 上海(118.89.101.176)
# 用法：
#   bash wusn-deploy.sh check    — 巡检全链路状态
#   bash wusn-deploy.sh status   — 同check
#   bash wusn-deploy.sh fix      — 自动修复异常
#   bash wusn-deploy.sh restart  — 重启全链路
#   bash wusn-deploy.sh deploy   — 首次部署或重新部署
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

# ---- 新加坡侧 ----
sg_status() {
  info "=== 新加坡侧检查 ==="
  local wss=$(pm2 list 2>/dev/null | grep hermes-wss-bridge)
  if echo "$wss" | grep -q "online"; then
    ok "WSS Server: online"
    echo "$wss" | awk '{print "   uptime:", $10, "restarts:", $9}'
  else
    fail "WSS Server: $(echo "$wss" | awk '{print $NF}')"
  fi

  # 心跳检查
  local heartbeat=$(pm2 logs hermes-wss-bridge --lines 3 --nostream 2>/dev/null | grep Heartbeat | tail -1)
  if echo "$heartbeat" | grep -q "connected"; then
    ok "心跳: executor connected"
  else
    warn "心跳: $(echo "$heartbeat" | grep -o 'disconnected' || echo 'no heartbeat log')"
  fi

  # WSS端口
  if ss -tlnp 2>/dev/null | grep -q ":$SG_WSS_PORT "; then
    ok "端口 $SG_WSS_PORT: 监听中"
  else
    fail "端口 $SG_WSS_PORT: 未监听"
  fi
}

sg_fix() {
  warn "尝试修复新加坡侧..."
  local wss_status=$(pm2 list 2>/dev/null | grep hermes-wss-bridge)
  if ! echo "$wss_status" | grep -q "online"; then
    # 端口被占？
    local old_pid=$(ss -tlnp 2>/dev/null | grep ":$SG_WSS_PORT " | grep -oP 'pid=\K[0-9]+')
    if [ -n "$old_pid" ]; then
      warn "端口被PID=$old_pid占用，杀掉..."
      kill $old_pid 2>/dev/null
      sleep 2
    fi
    pm2 delete hermes-wss-bridge 2>/dev/null
    pm2 start /home/agentuser/hermes-wss-server.js --name hermes-wss-bridge
    pm2 save
    ok "WSS Server已重启"
  fi
}

sg_restart() {
  info "重启新加坡WSS Server..."
  pm2 restart hermes-wss-bridge
  pm2 save
  ok "WSS Server已重启"
}

# ---- 上海侧（通过SSH）----
sh_cmd() { ssh -p $SSH_PORT -i $SSH_KEY -o ConnectTimeout=10 -o StrictHostKeyChecking=no $SSH_USER@$SH_IP "$@" 2>/dev/null; }

sh_status() {
  info "=== 上海侧检查 ==="
  local pm2_out=$(sh_cmd "sudo pm2 list 2>/dev/null | grep hermes-bridge")
  if echo "$pm2_out" | grep -q "hermes-bridge-client.*online"; then
    ok "client.js: online"
    echo "$pm2_out" | awk '{print "   uptime:", $10, "restarts:", $9}'
  else
    if echo "$pm2_out" | grep -q "hermes-bridge-client"; then
      fail "client.js: $(echo "$pm2_out" | grep hermes-bridge-client | awk '{print $NF}')"
    else
      fail "client.js: 未找到PM2进程"
    fi
  fi

  # server.js状态
  if echo "$pm2_out" | grep -q "hermes-bridge.*online"; then
    ok "server.js: online"
  else
    warn "server.js: $(echo "$pm2_out" | grep hermes-bridge | grep -v client | awk '{print $NF}')"
  fi

  # 最近client日志
  local log=$(sh_cmd "sudo tail -3 /root/.pm2/logs/hermes-bridge-client-out.log 2>/dev/null | grep -E 'Connected|Welcome|GW'")
  if [ -n "$log" ]; then
    ok "最近日志: $(echo "$log" | head -1)"
  else
    warn "无最近有效日志"
  fi

  # Gateway进程
  local gw_pid=$(sh_cmd "pgrep -f openclaw-gateway 2>/dev/null")
  if [ -n "$gw_pid" ]; then
    ok "OpenClaw Gateway: 运行中 (PID=$gw_pid)"
  else
    fail "OpenClaw Gateway: 未找到进程"
  fi
}

sh_fix() {
  warn "尝试修复上海侧..."
  local pm2_out=$(sh_cmd "sudo pm2 list 2>/dev/null | grep hermes-bridge-client")
  if ! echo "$pm2_out" | grep -q "online"; then
    sh_cmd "sudo pm2 restart hermes-bridge-client 2>/dev/null && echo OK" | grep -q "OK" && ok "client.js已重启" || warn "client.js重启失败"
  fi
  # 检查Gateway
  local gw_pid=$(sh_cmd "pgrep -f openclaw-gateway 2>/dev/null")
  if [ -z "$gw_pid" ]; then
    warn "Gateway未运行，尝试启动..."
    sh_cmd "sudo systemctl restart openclaw-gateway 2>/dev/null; sleep 3; pgrep -f openclaw-gateway" | grep -qE '^[0-9]+$' && ok "Gateway已启动" || fail "Gateway无法启动"
  fi
}

sh_restart() {
  info "重启上海侧..."
  sh_cmd "sudo pm2 restart hermes-bridge-client && sudo pm2 restart hermes-bridge"
  ok "上海侧已重启"
}

# ---- 全链路测试 ----
link_test() {
  info "=== 全链路测试 ==="
  local script="/tmp/wusn_deploy_test_$$.js"
  cat > $script << 'JSEOF'
const WebSocket = require('/home/agentuser/node_modules/ws');
const ws = new WebSocket('ws://127.0.0.1:18806');
const t0 = Date.now();
let done = false;
ws.on('open', () => { ws.send(JSON.stringify({taskId:'deploy_test_'+Date.now(), prompt:'回复ok，10字内', useKeen:true})); });
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
    ok "全链路: $(echo "$result" | head -1)"
  else
    fail "全链路: $result"
  fi
}

# ---- 主逻辑 ----
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
    info "首次部署指南："
    echo "  新加坡侧："
    echo "    pm2 start /home/agentuser/hermes-wss-server.js --name hermes-wss-bridge"
    echo "    pm2 save"
    echo "    上海侧（手动 or 远程执行）："
    echo "    ssh -p $SSH_PORT -i $SSH_KEY $SSH_USER@$SH_IP 'sudo pm2 start $SH_CLIENT_PATH/client.js --name hermes-bridge-client'"
    echo ""
    info "或直接已部署，运行 deploy 自动完成："
    sg_fix
    sh_fix
    echo
    link_test
    ;;
  *)
    echo "用法: bash wusn-deploy.sh [check|fix|restart|deploy]"
    echo "  check    巡检全链路"
    echo "  fix      自动修复异常"
    echo "  restart  重启全链路"
    echo "  deploy   部署/重部署"
    ;;
esac
