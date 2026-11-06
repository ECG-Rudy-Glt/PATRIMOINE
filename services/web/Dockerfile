FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Au démarrage : résolveur DNS et suffixe de recherche lus dans /etc/resolv.conf
# (Docker : 127.0.0.11 sans suffixe ; k8s : CoreDNS + <ns>.svc.cluster.local, les variables nginx
# ne bénéficiant pas des domaines de recherche)
COPY --chmod=755 <<'SH' /docker-entrypoint.d/05-resolver.sh
#!/bin/sh
ns=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)
search=$(awk '/^search/{print $2; exit}' /etc/resolv.conf)
case "$search" in *.svc.cluster.local) suffix=".$search" ;; *) suffix="" ;; esac
sed -i -e "s/resolver 127.0.0.11/resolver ${ns:-127.0.0.11}/" -e "s/__SEARCH__/$suffix/g" /etc/nginx/conf.d/default.conf
SH
# API Home Assistant (/ha/, lecture seule) : HA_API_TOKEN injecté au démarrage par 06-ha-token.sh ;
# l'image ne contient qu'un défaut « désactivé » (jamais de jeton)
COPY ha-proxy.inc ha-list.inc /etc/nginx/
COPY --chmod=755 ha-token.sh /docker-entrypoint.d/06-ha-token.sh
RUN printf 'map $http_authorization $ha_enabled { default 0; }\nmap $http_authorization $ha_authed { default 0; }\n' > /etc/nginx/ha-auth.map
