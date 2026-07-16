#!/usr/bin/env bash
# Notion2API — quick start (Linux / macOS)
# Usage: chmod +x start.sh && ./start.sh

set -euo pipefail
cd "$(dirname "$0")"

pick_python() {
  if [[ -x .venv/bin/python ]]; then
    echo ".venv/bin/python"
    return
  fi
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1; then
      echo "$c"
      return
    fi
  done
  echo ""
}

SYS_PY="$(pick_python)"
if [[ -z "$SYS_PY" ]]; then
  echo "Python 3.11+ not found. Install python3 and re-run."
  exit 1
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "Creating .venv with $SYS_PY ..."
  "$SYS_PY" -m venv .venv
fi

VPY=".venv/bin/python"
echo "Using: $VPY"

"$VPY" -m pip install -q --upgrade pip
"$VPY" -m pip install -q -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — set APP_MODE=standard"
fi

if [[ ! -f accounts.json ]]; then
  if [[ -f accounts.json.example ]]; then
    cp accounts.json.example accounts.json
  fi
  echo ""
  echo "accounts.json is missing or empty template."
  echo "  1) Prefer: browser extension notion2api-exporter (see README)"
  echo "  2) Or: .venv/bin/python login.py"
  echo "  3) Or: fill accounts.json manually (token_v2 + space_id + user_id)"
  echo ""
fi

echo "Starting server on http://127.0.0.1:8000 ..."
echo "UI:  http://localhost:8000"
echo "API: http://localhost:8000/v1/models"
echo "Stop: Ctrl+C"
echo ""

exec "$VPY" -m uvicorn app.server:app --host 0.0.0.0 --port 8000
