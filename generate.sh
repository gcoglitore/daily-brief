#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set. Export it before running:" >&2
  echo "  export ANTHROPIC_API_KEY=sk-ant-..." >&2
  exit 1
fi

if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && ! firebase login:list 2>/dev/null | grep -q '@'; then
  echo "ERROR: No Firebase auth detected. Either:" >&2
  echo "  1. Run 'firebase login' for local interactive use, or" >&2
  echo "  2. Export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json" >&2
  exit 1
fi

node update-content.js
firebase deploy --only hosting
