#!/usr/bin/env bash
# Tests automatiques, sans réseau : (1) tests unitaires des services, (2) application de toutes les migrations SQL sur un
# Postgres jetable + appel des fonctions SQL clés. Utilisé par la CI (.github/workflows/ci.yml) et en local : ./scripts/test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec > >(tee /tmp/patrimoine-ci-test.log) 2>&1   # journal conservé sur le runner (diagnostic d'un échec de CI)

echo "== Tests unitaires (python:3.12-slim)"
# Le conteneur tourne avec l'utilisateur de l'hôte et n'écrit pas de bytecode : sinon des dossiers __pycache__ appartenant à root
# restent dans le dépôt de travail du runner et font échouer les étapes suivantes (py_compile) et le prochain checkout.
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/w -w /w \
  -e HOME=/tmp -e PYTHONUSERBASE=/tmp/py -e PIP_CACHE_DIR=/tmp/pipcache -e PYTHONDONTWRITEBYTECODE=1 \
  -e DATABASE_URL=postgresql://t:t@localhost/t python:3.12-slim sh -ec '
  pip install -q --user --no-cache-dir -r services/ledger/requirements.txt -r services/advisor/requirements.txt \
      -r services/budget-engine/requirements.txt -r services/reporting/requirements.txt -r services/allocation-engine/requirements.txt -r services/ingestion-bank/requirements.txt
  for s in ledger advisor budget-engine reporting allocation-engine ingestion-bank; do
    echo "-- $s"; (cd services/$s && python -m unittest discover tests)
  done'
if [ -n "$(find services -user root 2>/dev/null | head -1)" ]; then echo "ERREUR : fichiers appartenant à root créés par les tests"; exit 1; fi

echo "== Migrations SQL sur Postgres jetable"
NAME="pg-ci-$$"
docker run -d --name "$NAME" -e POSTGRES_USER=patrimoine -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=patrimoine postgres:16 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U patrimoine -q 2>/dev/null && break; sleep 1; done
sleep 2   # le serveur redémarre une fois après l'initialisation de l'image
psql() { docker exec -i "$NAME" psql -U patrimoine -d patrimoine -v ON_ERROR_STOP=1 -q "$@"; }
n=0
for f in db/migrations/*.sql; do
  psql < "$f" >/dev/null || { echo "ÉCHEC migration : $f"; exit 1; }
  n=$((n + 1))
done
echo "$n migrations appliquées"
psql -c "SELECT count(*) FROM budget_monthly(NULL);" \
     -c "SELECT count(*) FROM account_weights(NULL);" \
     -c "SELECT count(*) FROM recurring(NULL);" \
     -c "SELECT categorize(FALSE);" \
     -c "SELECT count(*) FROM monthly_reports;" -c "SELECT count(*) FROM shared_items;" -c "SELECT count(*) FROM advisor_savings;" -c "SELECT count(*) FROM push_subscriptions;" >/dev/null
echo "Fonctions SQL clés : OK"
echo "TOUS LES TESTS PASSENT"
