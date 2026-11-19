#!/usr/bin/env bash
# Assistant d'installation de Patrimoine : crée .env (droits 600) avec des mots de passe aléatoires
# et pose quelques questions courtes sur les options facultatives.
#
# Usage :
#   ./scripts/setup.sh          assistant interactif
#   ./scripts/setup.sh --yes    non interactif : valeurs par défaut (ou variables d'environnement déjà exportées,
#                               par exemple ANTHROPIC_API_KEY exportée avant l'appel)
#   ./scripts/setup.sh --help
#
# Idempotent : si .env existe, les mots de passe déjà générés sont conservés ; seules les options
# facultatives que vous acceptez de modifier sont réécrites. Les secrets saisis ne sont jamais affichés.
set -euo pipefail
cd "$(dirname "$0")/.."

YES=0
case "${1:-}" in
  -y|--yes) YES=1 ;;
  -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "Option inconnue : $1 (voir --help)" >&2; exit 2 ;;
esac
# Sans terminal (pipe, CI), on se comporte comme --yes.
[ -t 0 ] || YES=1

command -v openssl >/dev/null 2>&1 || { echo "openssl est requis (apt install openssl / brew install openssl)." >&2; exit 1; }

# --- Outils -----------------------------------------------------------------------------------------------
get() { if [ -f .env ]; then sed -n "s/^$1=//p" .env | head -1; fi; }

# set_kv CLE VALEUR : remplace (ou ajoute) CLE=VALEUR dans .env ; la valeur passe par l'environnement pour
# échapper correctement tous les caractères spéciaux.
set_kv() {
  local tmp; tmp="$(mktemp .env.XXXXXX)"
  K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; done=0}
    index($0, k "=") == 1 {print k "=" v; done=1; next} {print}
    END{if(!done) print k "=" v}' .env > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" .env
}

# ask CLE "Question" [défaut] [secret]  -> réponse dans $REPLY_VAL
ask() {
  local prompt="$2" def="${3:-}" secret="${4:-}" ans=""
  if [ "$YES" = 1 ]; then REPLY_VAL="$def"; return; fi
  if [ -n "$def" ] && [ "$secret" != secret ]; then prompt="$prompt [$def]"; fi
  if [ "$secret" = secret ]; then
    printf '%s (saisie invisible) : ' "$prompt" >&2; read -r -s ans; echo >&2
  else
    printf '%s : ' "$prompt" >&2; read -r ans
  fi
  REPLY_VAL="${ans:-$def}"
}

# yesno "Question" [o|n] : code 0 pour oui
yesno() {
  local def="${2:-n}" ans
  if [ "$YES" = 1 ]; then [ "$def" = o ]; return; fi
  printf '%s [%s] : ' "$1" "$([ "$def" = o ] && echo O/n || echo o/N)" >&2; read -r ans
  ans="${ans:-$def}"; case "$ans" in o|O|y|Y|oui|yes) return 0 ;; *) return 1 ;; esac
}

# --- 1. Création du fichier .env ----------------------------------------------------------------------------
NEW=0
if [ ! -f .env ]; then
  NEW=1
  DB_SECRET="$(openssl rand -hex 16)"
  GRAFANA_SECRET="$(openssl rand -hex 16)"
  ( umask 077
    sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${DB_SECRET}|" \
        -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://patrimoine:${DB_SECRET}@postgres:5432/patrimoine|" \
        -e "s|^GF_SECURITY_ADMIN_PASSWORD=.*|GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_SECRET}|" \
        .env.example > .env )
  chmod 600 .env
  echo "OK  .env créé avec des mots de passe aléatoires (droits 600)."
else
  chmod 600 .env
  echo "OK  .env existe déjà : mots de passe conservés."
fi
mkdir -p secrets

# --- 2. Options facultatives ----------------------------------------------------------------------------------
if [ "$YES" = 1 ]; then
  # Non interactif : on reprend les variables d'environnement exportées, sans rien demander.
  for k in ANTHROPIC_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM NTFY_TOPIC NTFY_URL EB_APP_ID APP_URL; do
    v="${!k:-}"
    if [ -n "$v" ] && [ "$v" != "$(get "$k")" ]; then set_kv "$k" "$v"; fi
  done
else
  echo
  echo "Options facultatives (Entrée = passer). Tout se change plus tard dans .env."

  echo
  echo "1/5  Adresse d'accès (utilisée dans les liens des e-mails et notifications)"
  ask APP_URL "     Adresse de l'application" "$(get APP_URL)"; [ -n "$REPLY_VAL" ] && set_kv APP_URL "$REPLY_VAL"

  echo
  echo "2/5  Conseiller IA (clé API Anthropic, https://console.anthropic.com)"
  if yesno "     Activer le conseiller IA ?" n; then
    ask ANTHROPIC_API_KEY "     Clé API" "" secret; [ -n "$REPLY_VAL" ] && set_kv ANTHROPIC_API_KEY "$REPLY_VAL"
  fi

  echo
  echo "3/5  Digest par e-mail (serveur SMTP ; Gmail : smtp.gmail.com + mot de passe d'application)"
  if yesno "     Activer l'envoi d'e-mails ?" n; then
    ask SMTP_HOST "     Serveur SMTP" "$(get SMTP_HOST)"; [ -n "$REPLY_VAL" ] && set_kv SMTP_HOST "$REPLY_VAL"
    ask SMTP_PORT "     Port" "$(get SMTP_PORT)"; [ -n "$REPLY_VAL" ] && set_kv SMTP_PORT "$REPLY_VAL"
    ask SMTP_USER "     Utilisateur (adresse e-mail)" ""; U="$REPLY_VAL"
    [ -n "$U" ] && set_kv SMTP_USER "$U"
    ask SMTP_PASSWORD "     Mot de passe" "" secret; [ -n "$REPLY_VAL" ] && set_kv SMTP_PASSWORD "$REPLY_VAL"
    ask SMTP_FROM "     Expéditeur" "$U"; [ -n "$REPLY_VAL" ] && set_kv SMTP_FROM "$REPLY_VAL"
  fi

  echo
  echo "4/5  Notifications ntfy (https://ntfy.sh ; le nom du sujet sert de mot de passe)"
  if yesno "     Activer les notifications ntfy ?" n; then
    ask NTFY_TOPIC "     Nom du sujet (vide = en générer un aléatoire)" ""
    set_kv NTFY_TOPIC "${REPLY_VAL:-patrimoine-$(openssl rand -hex 8)}"
    ask NTFY_URL "     Serveur ntfy" "$(get NTFY_URL)"; [ -n "$REPLY_VAL" ] && set_kv NTFY_URL "$REPLY_VAL"
  fi

  echo
  echo "5/5  Banques automatiques (Enable Banking, gratuit pour ses propres comptes)"
  echo "     Sans cela, vous pouvez importer vos relevés (CSV, OFX) depuis l'application."
  if yesno "     Configurer Enable Banking ?" n; then
    ask EB_APP_ID "     Identifiant d'application (EB_APP_ID)" "$(get EB_APP_ID)"; [ -n "$REPLY_VAL" ] && set_kv EB_APP_ID "$REPLY_VAL"
    echo "     Placez ensuite votre clé privée dans secrets/enablebanking.pem"
  fi
fi

# --- 3. Suite ---------------------------------------------------------------------------------------------------
echo
echo "Configuration terminée. Étape suivante :"
echo
echo "    docker compose up -d --build"
echo
echo "puis ouvrez $(get APP_URL)."
echo "Les secrets sont dans .env (droits 600) : ne le partagez pas et ne le versionnez pas."
if [ "$NEW" = 0 ]; then
  echo "Pour tout regénérer : supprimez .env puis relancez ce script (la base existante gardera l'ancien mot de passe)."
fi
