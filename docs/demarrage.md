# Premiers pas

Ce guide suit l'[installation](installation.md) : vous avez une instance qui tourne sur <http://localhost:8080> et vous voulez y mettre **vos** données. [English version](getting-started.md).

Les commandes `docker compose` se lancent depuis le dossier du dépôt. Certaines étapes appellent l'API du ledger sur `http://localhost:8000` (documentation interactive : <http://localhost:8000/docs>).

## 1. De la démo à vos vraies données

La [démo en ligne](https://patrimoine-demo.gault-rudy.com) est un site à part, avec des données fictives. Votre installation locale, elle, démarre **sans compte ni opération** : seules deux personnes d'exemple, *Alex* et *Sam*, existent, plus les catégories, règles et réglages par défaut. Il n'y a donc rien à effacer : on renomme les personnes, puis on ajoute ses comptes. Tant qu'aucun compte n'existe, les chiffres sont à zéro, c'est normal.

## 2. Créer ou renommer les personnes du foyer

Il n'y a pas encore d'écran pour cela (seule l'adresse e-mail se règle dans l'application, écran **Alertes**). Les personnes sont dans la table `persons` (`id`, `name` unique, `email`). Renommer :

```bash
docker compose exec postgres psql -U patrimoine -c "UPDATE persons SET name = 'Camille' WHERE id = 1;"
docker compose exec postgres psql -U patrimoine -c "UPDATE persons SET name = 'Jordan' WHERE id = 2;"
```

Ajouter une personne (l'identifiant est attribué automatiquement) :

```bash
docker compose exec postgres psql -U patrimoine -c "INSERT INTO persons (name, email) VALUES ('Nom', 'nom@exemple.org') RETURNING id;"
```

Vivre seul(e) : renommez la personne 1 et supprimez l'autre avec `DELETE FROM persons WHERE id = 2;` (ses parts de comptes, son profil fiscal sont supprimés avec elle ; ses objectifs et recommandations restent, sans personne associée). Lister : `docker compose exec postgres psql -U patrimoine -c "SELECT id, name, email FROM persons ORDER BY id;"`.

Si vous avez changé `POSTGRES_USER` ou `POSTGRES_DB` dans `.env`, adaptez `-U` (et ajoutez `-d`).

## 3. Ajouter des comptes, leurs parts et leurs soldes

Un compte a un **type** parmi `courant`, `livret`, `pea`, `assurance_vie`, `per`, `cto`, `immobilier`, `autre`, et des **titulaires** (table `account_holders`) avec une quote-part de 0 (exclu) à 1 ; la somme des parts d'un compte doit valoir 1 (compte joint à parts égales : 0,5 et 0,5).

**Comptes bancaires** : le plus simple est de connecter la banque (étape 5) ; les comptes apparaissent alors dans **Comptes**.

**Comptes de placement** (`pea`, `cto`, `assurance_vie`, `per`) : ajoutez-les depuis l'écran **Investir**, avec leurs titulaires.

**Solde saisi à la main** (livret, immobilier, tout compte sans connexion bancaire) : un appel idempotent crée le compte ou met à jour sa valorisation du jour ; rejouez-le à chaque nouveau solde.

```bash
curl -X PUT http://localhost:8000/accounts/sync -H 'Content-Type: application/json' -d '{
  "external_id": "manuel:livret-a-camille",
  "source": "manuel",
  "institution": "Ma banque",
  "name": "Livret A",
  "type": "livret",
  "currency": "EUR",
  "balance": 4200.50,
  "day": "2026-01-31"
}'
```

La réponse contient l'`id` du compte (par exemple `{"id": 7, "alerts": 0}`). `external_id` est votre clé : un second appel avec le même identifiant met à jour le compte (et la valorisation du jour donné) au lieu d'en créer un autre. Pour un compte `source: "manuel"`, le type peut être corrigé par un nouvel appel. Un compte créé ainsi n'a pas de titulaire tant que vous n'en déclarez pas :

```bash
curl -X PUT http://localhost:8000/accounts/7/holders -H 'Content-Type: application/json' \
  -d '{"holders": {"1": 0.5, "2": 0.5}}'
```

Les clés sont les `id` des personnes. La somme doit valoir 1, sinon l'API répond 422. Le même appel remplace les parts précédentes.

**Importer un historique** (CSV ou OFX exportés depuis votre banque) : écran **Export**, « Importer un historique ». L'import analyse d'abord le fichier sans rien écrire (aperçu), puis vous confirmez ; il ne crée pas de doublon. Il s'applique aux comptes courants et livrets qui ne sont pas saisis à la main (taille maximale 8 Mo).

## 4. Brancher le conseiller IA

Le conseiller **ne calcule rien** : il interprète vos chiffres réels et chaque conseil cite les chiffres sur lesquels il s'appuie. Rien n'est exécuté à votre place.

> Aujourd'hui, **seul Claude (Anthropic)** est pris en charge. Le choix d'un autre fournisseur (API compatible OpenAI, modèle local via Ollama) est **à venir** ; il n'est pas encore disponible.

1. Créez un compte sur <https://console.anthropic.com>, ajoutez des crédits ou un moyen de paiement, puis créez une clé dans la section « API keys ». C'est une facturation à l'usage, distincte d'un abonnement Claude.
2. Placez la clé dans `.env` : soit en relançant `./scripts/setup.sh` (réponse « oui » à la question du conseiller IA ; la saisie est invisible), soit en éditant la ligne `ANTHROPIC_API_KEY=` de `.env` avec votre clé.
3. Appliquez : `docker compose up -d`.
4. Vérifiez que le service voit la clé :
   ```bash
   docker compose exec advisor python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/health').read().decode())"
   ```
   La réponse doit contenir `"configured": true` et le modèle utilisé. Dans l'application, l'écran **Conseils** n'affiche plus « Conseiller inactif ».

**Modèles.** Le conseiller utilise `ADVISOR_MODEL` (par défaut `claude-sonnet-5-5`) pour les analyses ; le document de stratégie d'épargne est rédigé par `STRATEGY_MODEL` (par défaut `claude-opus-5-5`). Les deux se changent dans `.env`. Les tarifs connus sont ceux des modèles listés dans `services/advisor/app/main.py` ; un modèle inconnu est compté au tarif le plus élevé, par prudence, dans le calcul du plafond.

**Plafond de budget.** La dépense API du mois civil est mesurée (table `api_usage`) et affichée en haut de l'écran **Conseils**. Le plafond mensuel vaut **5 $** par défaut (réglage `advisor_monthly_budget_usd`) : avant chaque appel, le conseiller refuse de partir si la dépense du mois plus le coût maximal estimé d'une analyse (environ 0,30 $) dépasserait le plafond. Pour le changer, par exemple à 10 $ :

```bash
docker compose exec postgres psql -U patrimoine -c "UPDATE settings SET value = 10 WHERE key = 'advisor_monthly_budget_usd';"
```

Fixez en plus une limite de dépense dans la console Anthropic : c'est le garde-fou côté fournisseur.

**Déclenchement.** Le bouton « Demander un avis » lance une analyse à la demande (1 à 2 minutes) ; elles partent aussi seules sur des faits précis (fin de cycle de paie, plafond dépassé, objectif hors de portée…). Le document de stratégie se rédige à la demande (environ 0,30 $).

## 5. Banques, e-mail, notifications

Tout est facultatif et se règle dans `.env`, puis `docker compose up -d`.

- **Banques (Enable Banking).** API DSP2 officielles, accès restreint gratuit à vos propres comptes. Créez une application sur <https://enablebanking.com/cp/> (Production, mode restreint), placez la clé privée dans `secrets/enablebanking.pem`, renseignez `EB_APP_ID`, puis autorisez chaque banque depuis l'écran **Banques**. Pas à pas, commandes et renouvellement du consentement (environ 180 jours) : [déploiement](deploiement.md#connecter-ses-banques-enable-banking). La synchronisation est un job : `docker compose --profile jobs run --rm ingestion-bank`, ou `scripts/sync.sh` en cron, ou les timers `systemd` de `deploy/systemd/`.
- **E-mail (digest mensuel).** Renseignez `SMTP_HOST`, `SMTP_PORT` (587 par défaut), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` et `APP_URL` (adresse utilisée dans les liens). Avec Gmail : `smtp.gmail.com` et un mot de passe d'application. Chaque personne reçoit le digest à l'adresse saisie dans l'écran **Alertes**. Envoi immédiat : `docker compose exec reporting python -m app.main --send` ; envoi mensuel : timer `deploy/systemd/patrimoine-digest.timer`.
- **Notifications ntfy.** `NTFY_TOPIC` (le nom du sujet sert de mot de passe : choisissez-le long et aléatoire, `setup.sh` en génère un), `NTFY_URL` (par défaut `https://ntfy.sh`, ou votre serveur) et éventuellement `NTFY_TOKEN`. Abonnez votre téléphone à ce sujet dans l'application ntfy. Test : `curl -X POST http://localhost:8000/alerts/test` doit faire arriver « Patrimoine : test ».
- **Cours de marché** (facultatif) : `TWELVEDATA_API_KEY` et `FRED_API_KEY`, gratuites.

## 6. Application de bureau

Une fenêtre dédiée pour Windows et Linux, qui se connecte à votre serveur : voir [application-bureau.md](application-bureau.md) (téléchargement, vérification SHA-256, avertissement SmartScreen).

## 7. Sauvegarde et mise à jour

```bash
# sauvegarde de la base
docker compose exec -T postgres pg_dump -U patrimoine -d patrimoine -Fc > patrimoine-$(date +%F).dump
# mise à jour
git pull && docker compose up -d --build
```

Sauvegardez aussi `.env` et `secrets/` (clé Enable Banking) dans un endroit chiffré, hors de la machine. Les migrations de `db/migrations/` sont appliquées automatiquement par le ledger au démarrage : faites une sauvegarde avant chaque mise à jour. Restauration et dépannage : [installation](installation.md#sauvegarde-et-restauration).

Rappel : il n'y a pas de compte utilisateur, placez un reverse proxy authentifié devant l'application avant de l'exposer ([installation](installation.md#authentification--à-placer-devant)).
