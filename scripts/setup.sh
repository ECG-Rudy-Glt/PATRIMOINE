#!/usr/bin/env bash
# Prépare l'installation en une commande : génère .env avec des secrets aléatoires.
# Usage : ./scripts/setup.sh   puis   docker compose up -d --build
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env existe déjà : rien à faire (supprimez-le pour en générer un nouveau)."
  exit 0
fi

rand() { openssl rand -hex 16; }
DB_SECRET="$(rand)"
GRAFANA_SECRET="$(rand)"

# On part de l'exemple et on remplace uniquement les valeurs à générer.
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${DB_SECRET}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://patrimoine:${DB_SECRET}@postgres:5432/patrimoine|" \
    -e "s|^GF_SECURITY_ADMIN_PASSWORD=.*|GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_SECRET}|" \
    .env.example > .env
chmod 600 .env
mkdir -p secrets

cat <<'EOF'
.env créé (droits 600) avec des mots de passe aléatoires.

Suite :
  docker compose up -d --build
  ouvrir http://localhost:8080

Optionnel, dans .env : ANTHROPIC_API_KEY (conseiller IA), EB_APP_ID (banques via Enable Banking),
SMTP_* (digest par e-mail), NTFY_* (notifications). Voir README.md.
EOF
