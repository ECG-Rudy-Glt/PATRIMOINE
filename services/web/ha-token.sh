#!/bin/sh
# Génère /etc/nginx/ha-auth.map depuis HA_API_TOKEN (secret k8s patrimoine-secrets).
# Jeton vide, trop court (< 24) ou hors [A-Za-z0-9_-] : /ha/ désactivé (404). Le jeton n'est ni journalisé
# ni dans l'image ; le fichier est lisible par root seulement (le maître nginx le lit avant de lâcher ses droits).
f=/etc/nginx/ha-auth.map
t=$(printf %s "${HA_API_TOKEN:-}" | tr -d '[:space:]')
umask 077
if [ "${#t}" -ge 24 ] && printf %s "$t" | grep -Eq '^[A-Za-z0-9_-]+$'; then
  cat > "$f" <<MAP
map \$http_authorization \$ha_enabled { default 1; }
map \$http_authorization \$ha_authed { default 0; "~^\s*[Bb][Ee][Aa][Rr][Ee][Rr]\s+${t}\s*\$" 1; }
MAP
  echo "ha-token : API /ha/ activée"
else
  [ -n "${HA_API_TOKEN:-}" ] && echo "ha-token : HA_API_TOKEN invalide ou trop court (24 caractères [A-Za-z0-9_-] minimum) : /ha/ désactivée"
  printf 'map $http_authorization $ha_enabled { default 0; }\nmap $http_authorization $ha_authed { default 0; }\n' > "$f"
fi
exit 0
