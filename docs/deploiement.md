# Déploiement

## En une commande

Prérequis : Docker et Docker Compose.

```bash
git clone https://github.com/ECG-Rudy-Glt/PATRIMOINE.git
cd PATRIMOINE
./scripts/setup.sh                # crée .env avec des mots de passe aléatoires
docker compose up -d --build      # construit et démarre tout
```

Puis ouvrez <http://localhost:8080>.

- Interface : <http://localhost:8080>
- API du ledger : <http://localhost:8000> (documentation interactive sur `/docs`)
- Grafana : <http://localhost:3000> (utilisateur `admin`, mot de passe : `GF_SECURITY_ADMIN_PASSWORD` dans `.env`)

Vérification rapide : `curl localhost:8000/health` renvoie `{"status":"ok"}`.

Pour repartir de zéro (efface les données) : `docker compose down -v`.

## Configuration

Tout se règle dans `.env` (voir `.env.example`, chaque variable est commentée). Seuls les mots de passe de la base et de Grafana sont obligatoires, et `setup.sh` les génère. Le reste est optionnel :

| Fonction | Variables |
|---|---|
| Conseiller IA | `ANTHROPIC_API_KEY`, `ADVISOR_MODEL` |
| Banques (Enable Banking) | `EB_APP_ID`, clé privée dans `secrets/enablebanking.pem` |
| Digest par e-mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `APP_URL` |
| Notifications | `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` |
| Cours de marché | `TWELVEDATA_API_KEY`, `FRED_API_KEY` |
| Home Assistant | `HA_WEBHOOK_URL`, `HA_EVENTS_WEBHOOK_URL`, `HA_API_TOKEN` |

## Connecter ses banques (Enable Banking)

Le connecteur par défaut utilise les API DSP2 officielles des banques via [Enable Banking](https://enablebanking.com/cp/) (accès restreint gratuit à ses propres comptes). Vos identifiants bancaires sont saisis chez la banque, jamais dans ce projet.

1. Créez une application Enable Banking en environnement **Production**, mode restreint. Redirect URL : `https://localhost/callback` (elle n'a pas besoin de répondre). Le portail fournit un **Application ID** et une **clé privée** `.pem`.
2. Placez la clé dans `secrets/enablebanking.pem` (dossier ignoré par git) et renseignez `EB_APP_ID` dans `.env`.
3. Autorisez chaque banque depuis l'écran **Banques** de l'interface, ou en ligne de commande :

```bash
alias eb='docker compose --profile jobs run --rm ingestion-bank python -m app.enablebanking'
eb banks | grep -i "ma banque"     # nom exact
eb link "Ma banque"                # affiche une URL d'autorisation
# après l'authentification chez la banque, copiez la valeur `code` de l'URL de retour :
eb session LE_CODE
```

4. Synchronisez : `docker compose --profile jobs run --rm ingestion-bank`. Relançable sans doublon.

Le consentement DSP2 dure environ 180 jours : l'écran « Banques » alerte avant l'expiration.

## Planification

Les tâches périodiques (synchronisation bancaire, cours de marché, digest) se lancent avec le profil `jobs`. Des exemples de timers `systemd` sont fournis dans `deploy/systemd/` ; un simple `cron` appelant `scripts/sync.sh` convient aussi.

## Exposition sur Internet

Ne publiez jamais les ports tels quels. Placez un reverse proxy **avec authentification** devant l'interface (port 8080), par exemple Caddy, Traefik ou nginx avec un SSO. Exemple minimal avec Caddy et une authentification de base :

```
patrimoine.example.org {
    basicauth {
        votre-utilisateur HASH_GENERE_AVEC_caddy_hash-password
    }
    reverse_proxy 127.0.0.1:8080
}
```

## Sauvegardes

La base contient toutes vos données. Sauvegardez-la régulièrement et chiffrez les sauvegardes :

```bash
docker compose exec -T postgres pg_dump -U patrimoine -d patrimoine -Fc > patrimoine-$(date +%F).dump
# restauration : pg_restore --clean --if-exists --no-owner -d patrimoine patrimoine-AAAA-MM-JJ.dump
```
