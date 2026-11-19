# Installation

Ce guide installe Patrimoine sur votre ordinateur ou votre serveur, en deux commandes. [English version](installation.en.md).

## Prérequis

- **Docker** avec **Docker Compose v2** ([installer Docker](https://docs.docker.com/get-docker/)). Sous Windows et macOS : Docker Desktop.
- **Git** et **openssl** (déjà présents sur la plupart des systèmes Linux et macOS ; sous Windows, `setup.ps1` n'en a pas besoin).
- Environ 2 Go de RAM libres et 3 Go de disque.

## Installation en deux commandes

```bash
git clone https://github.com/ECG-Rudy-Glt/PATRIMOINE.git && cd PATRIMOINE
./scripts/setup.sh && docker compose up -d --build
```

Sous Windows (PowerShell) :

```powershell
git clone https://github.com/ECG-Rudy-Glt/PATRIMOINE.git; cd PATRIMOINE
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
docker compose up -d --build
```

L'assistant `setup` :

- génère des mots de passe aléatoires et écrit `.env` (droits restreints, jamais versionné) ;
- pose cinq questions **facultatives** (adresse d'accès, conseiller IA, e-mail, notifications ntfy, banques). Appuyez sur Entrée pour passer : tout se change plus tard dans `.env` ;
- ne montre jamais les secrets saisis ;
- peut être relancé sans danger : un `.env` existant garde ses mots de passe ;
- accepte `--yes` (PowerShell : `-Yes`) pour une installation sans question, par exemple pour l'automatiser.

La première construction prend quelques minutes.

## Première connexion

Ensuite : [premiers pas](demarrage.md) (vos personnes et comptes, conseiller IA, banques, sauvegarde).

1. Ouvrez <http://localhost:8080>.
2. L'application démarre avec deux personnes d'exemple, *Alex* et *Sam*. Renommez-les en SQL : `docker compose exec postgres psql -U patrimoine -c "UPDATE persons SET name = 'Votre prénom' WHERE id = 1;"`.
3. Ajoutez vos comptes : importez un relevé (CSV ou OFX) depuis l'écran **Export** (« Importer un historique »), ou connectez vos banques (écran **Banques**, voir [déploiement](deploiement.md#connecter-ses-banques-enable-banking)).
4. Vérification rapide : `curl http://localhost:8000/health` doit répondre `{"status":"ok"}`.

Il n'y a **pas de compte utilisateur** : voir « Authentification » plus bas.

## Authentification : à placer devant

Patrimoine n'embarque pas de système de connexion. Les ports sont liés à `127.0.0.1` : l'application n'est accessible que depuis la machine qui l'héberge. Pour l'utiliser depuis un autre appareil ou depuis Internet, placez un **reverse proxy qui authentifie** devant le port 8080 (Caddy, Traefik ou nginx avec authentification de base, ou un SSO tel qu'Authentik). Ne publiez jamais les ports tels quels : l'application contient vos données financières. Un exemple Caddy est dans [deploiement.md](deploiement.md#exposition-sur-internet). Chiffrez aussi le disque de la machine.

## Mise à jour

```bash
git pull
docker compose up -d --build
```

Les migrations de base de données sont appliquées automatiquement au démarrage. Faites une sauvegarde avant (voir ci-dessous).

## Sauvegarde et restauration

```bash
# sauvegarde
docker compose exec -T postgres pg_dump -U patrimoine -d patrimoine -Fc > patrimoine-$(date +%F).dump
# restauration (sur une installation propre)
docker compose exec -T postgres pg_restore -U patrimoine -d patrimoine --clean --if-exists --no-owner < patrimoine-AAAA-MM-JJ.dump
```

Sauvegardez aussi `.env` et le dossier `secrets/` (clé Enable Banking), dans un endroit chiffré. Conservez les sauvegardes hors de la machine.

## Arrêter, repartir de zéro

```bash
docker compose down        # arrêt, données conservées
docker compose down -v     # arrêt ET effacement des données
```

## Dépannage

| Symptôme | Piste |
|---|---|
| `docker: command not found` | Docker n'est pas installé ou pas dans le PATH ; relancez le terminal. |
| La page ne s'ouvre pas | `docker compose ps` : tous les services doivent être « running ». Voir les journaux : `docker compose logs -f ledger web`. |
| Le port 8080 (ou 8000, 3000, 5432) est déjà pris | Arrêtez le programme qui l'utilise, ou changez le port à gauche des `ports:` dans `docker-compose.yml` (ex. `127.0.0.1:8081:80`). |
| `password authentication failed` après avoir supprimé `.env` | La base garde l'ancien mot de passe. Remettez l'ancien `.env`, ou repartez de zéro avec `docker compose down -v` (efface les données). |
| Chiffres à zéro | Aucun compte importé : ajoutez un relevé ou connectez une banque. |
| Conseiller IA indisponible | `ANTHROPIC_API_KEY` absente de `.env` : relancez `./scripts/setup.sh` ou éditez `.env`, puis `docker compose up -d`. |
| Windows : `setup.ps1` refusé | Lancez-le avec `powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1`. |
| Après modification de `.env` rien ne change | `docker compose up -d` recrée les services concernés. |

Un problème qui persiste ? Ouvrez une *issue* en joignant les journaux (sans aucune donnée personnelle ni secret).
