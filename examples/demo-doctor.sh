#!/usr/bin/env bash
# 不用 set -e：doctor 有 error 时退出 1 属正常
# 不用 pipefail：管道里 "doctor --json | node" 会因 doctor 退出 1 中断
set -uo pipefail
cd "$(dirname "$0")/.."

TMP_DIR=".tred-tmp"
mkdir -p "$TMP_DIR"
JSON_OUT="$TMP_DIR/doctor-output.json"

echo "=== 1/2 tred doctor（人类可读，有 error 时退出 1 属预期） ==="
node bin/tred.mjs doctor
DOCTOR_RC=$?
if [ "$DOCTOR_RC" -ne 0 ] && [ "$DOCTOR_RC" -ne 1 ]; then
  echo "❌ doctor 意外退出码: $DOCTOR_RC" >&2
  exit 1
fi

echo
echo "=== 2/2 tred doctor --json | 关键字段 ==="
node bin/tred.mjs doctor --json > "$JSON_OUT"
JSON_DOCTOR_RC=$?
if [ "$JSON_DOCTOR_RC" -ne 0 ] && [ "$JSON_DOCTOR_RC" -ne 1 ]; then
  echo "❌ doctor --json 意外退出码: $JSON_DOCTOR_RC" >&2
  rm -f "$JSON_OUT"
  exit 1
fi
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("ok="+j.ok+", branch="+j.git.branch+", anchors="+j.anchors.total+", cache="+j.cache.exists+", version_match="+(j.tredVersion===j.packageVersion))' "$JSON_OUT"
PARSE_RC=$?
rm -f "$JSON_OUT"
if [ "$PARSE_RC" -ne 0 ]; then
  echo "❌ doctor --json 解析失败: $PARSE_RC" >&2
  exit 1
fi

