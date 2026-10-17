#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== 1/2 verify --format sarif（有 error） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --format sarif > /tmp/tred-sarif-1.json || true
node -e 'const s=JSON.parse(require("fs").readFileSync("/tmp/tred-sarif-1.json","utf-8"));console.log("version="+s.version+", results="+s.runs[0].results.length+", rules="+s.runs[0].tool.driver.rules.length)'

echo
echo "=== 2/2 健康项目 verify --format sarif ==="
node bin/tred.mjs verify --dir examples/_diff_dir_demo/v1 --format sarif > /tmp/tred-sarif-2.json || true
node -e 'const s=JSON.parse(require("fs").readFileSync("/tmp/tred-sarif-2.json","utf-8"));console.log("version="+s.version+", results="+s.runs[0].results.length)'

rm -f /tmp/tred-sarif-*.json

