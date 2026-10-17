#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

DEMO_DIR=".tred-tmp/watch-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

cat > "$DEMO_DIR/a.ts" <<'EOF'
// @TRED_START: X | fp=11111111
// @TRED_END: X
EOF

echo "=== tred watch（自动 6 秒停止，期间改 2 次文件） ==="

node -e '
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const p = spawn("node", ["bin/tred.mjs", "watch", "--dir", dir], { stdio: "inherit" });
setTimeout(() => {
  console.log("");
  console.log("[demo] 改 a.ts，应触发重新 verify");
  fs.writeFileSync(path.join(dir, "a.ts"), "// @TRED_START: X | fp=99999999\n// @TRED_END: X\n");
}, 1800);
setTimeout(() => {
  console.log("");
  console.log("[demo] 加 broken.ts，应报 error");
  fs.writeFileSync(path.join(dir, "broken.ts"), "// @TRED_START: Z\nbody\n");
}, 3600);
setTimeout(() => {
  console.log("");
  console.log("[demo] 发送 SIGINT");
  p.kill("SIGINT");
}, 5200);
setTimeout(() => { if (!p.killed) p.kill("SIGKILL"); process.exit(0); }, 7000);
' "$DEMO_DIR"

rm -rf "$DEMO_DIR"

