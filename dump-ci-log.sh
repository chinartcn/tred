#!/usr/bin/env bash
set -euo pipefail

# 1. 获取最新一次失败的 Run ID
RUN_ID=$(gh run list -b main -L 1 --json databaseId,conclusion -q '.[0].databaseId')

if [ -z "$RUN_ID" ]; then
  echo "❌ 没有找到最近的 Run"
  exit 1
fi

echo "🔍 抓取 Run ID: $RUN_ID 的失败日志..."
gh run view "$RUN_ID" --log-failed > ci-error.log 2>&1

echo "✅ 日志已保存到 ci-error.log"
