#!/usr/bin/env bash
# Synchronisation quotidienne (cron VM, en attendant le CronJob K8s)
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== $(date -Is) ==="
docker compose up -d postgres ledger >/dev/null 2>&1
for i in $(seq 30); do curl -sf localhost:8000/health >/dev/null && break; sleep 2; done
docker compose --profile jobs run --rm ingestion-bank 2>&1 | grep -v -E '^ ?(Container|Network)'
STALE=$(curl -sf localhost:8000/stale)
[ "$STALE" = "[]" ] || echo "ALERTE comptes non rafraîchis : $STALE"
