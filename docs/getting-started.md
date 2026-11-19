# Getting started

This guide follows the [installation](installation.en.md): you have an instance running on <http://localhost:8080> and you want to put **your** data in it. [Version française](demarrage.md).

Run `docker compose` commands from the repository folder. Some steps call the ledger API on `http://localhost:8000` (interactive documentation: <http://localhost:8000/docs>).

## 1. From the demo to your real data

The [online demo](https://patrimoine-demo.gault-rudy.com) is a separate site with fictional data. Your local install starts with **no accounts and no transactions**: only two example people, *Alex* and *Sam*, exist, plus the default categories, rules and settings. There is nothing to wipe: rename the people, then add your accounts. Until an account exists, the figures show zero, which is expected.

## 2. Create or rename the household members

There is no screen for this yet (only the e-mail address can be set in the app, on the **Alerts** screen). People live in the `persons` table (`id`, unique `name`, `email`). To rename:

```bash
docker compose exec postgres psql -U patrimoine -c "UPDATE persons SET name = 'Camille' WHERE id = 1;"
docker compose exec postgres psql -U patrimoine -c "UPDATE persons SET name = 'Jordan' WHERE id = 2;"
```

To add a person (the id is assigned automatically):

```bash
docker compose exec postgres psql -U patrimoine -c "INSERT INTO persons (name, email) VALUES ('Name', 'name@example.org') RETURNING id;"
```

Living alone: rename person 1 and delete the other with `DELETE FROM persons WHERE id = 2;` (their account shares and tax profile are deleted with them; their goals and recommendations stay, with no person attached). To list: `docker compose exec postgres psql -U patrimoine -c "SELECT id, name, email FROM persons ORDER BY id;"`.

If you changed `POSTGRES_USER` or `POSTGRES_DB` in `.env`, adjust `-U` (and add `-d`).

## 3. Add accounts, their shares and balances

An account has a **type** among `courant` (checking), `livret` (savings), `pea`, `assurance_vie`, `per`, `cto`, `immobilier` (real estate), `autre` (other), and **holders** (table `account_holders`) each with a share above 0 and up to 1; the shares of an account must sum to 1 (joint account split evenly: 0.5 and 0.5).

**Bank accounts**: the easiest way is to connect the bank (step 5); the accounts then appear under **Accounts**.

**Investment accounts** (`pea`, `cto`, `assurance_vie`, `per`): add them from the **Invest** screen, with their holders.

**Manually entered balance** (savings book, property, any account without a bank connection): an idempotent call creates the account or updates its valuation for the given day; replay it whenever you have a new balance.

```bash
curl -X PUT http://localhost:8000/accounts/sync -H 'Content-Type: application/json' -d '{
  "external_id": "manuel:livret-a-camille",
  "source": "manuel",
  "institution": "My bank",
  "name": "Savings book",
  "type": "livret",
  "currency": "EUR",
  "balance": 4200.50,
  "day": "2026-01-31"
}'
```

The response contains the account `id` (for example `{"id": 7, "alerts": 0}`). `external_id` is your key: a second call with the same value updates the account (and the valuation for that day) instead of creating another. For a `source: "manuel"` account, the type can be corrected by a new call. An account created this way has no holder until you declare some:

```bash
curl -X PUT http://localhost:8000/accounts/7/holders -H 'Content-Type: application/json' \
  -d '{"holders": {"1": 0.5, "2": 0.5}}'
```

Keys are person `id`s. The shares must sum to 1, otherwise the API answers 422. The same call replaces any previous shares.

**Import a history** (CSV or OFX exported from your bank): **Export** screen, "Importer un historique". The import first analyses the file without writing anything (preview), then you confirm; it creates no duplicates. It applies to checking and savings accounts that are not manually entered (8 MB maximum).

## 4. Connect the AI advisor

The advisor **calculates nothing**: it interprets your real figures and each piece of advice cites the figures it relies on. Nothing is executed on your behalf.

> Today **only Claude (Anthropic)** is supported. Choosing another provider (OpenAI-compatible API, local model through Ollama) is **planned** ("coming"); it is not available yet.

1. Create an account at <https://console.anthropic.com>, add credits or a payment method, then create a key under "API keys". Billing is pay-as-you-go, separate from any Claude subscription.
2. Put the key in `.env`: either rerun `./scripts/setup.sh` (answer yes to the AI advisor question; input is hidden), or edit the `ANTHROPIC_API_KEY=` line of `.env` with your key.
3. Apply: `docker compose up -d`.
4. Check that the service sees the key:
   ```bash
   docker compose exec advisor python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/health').read().decode())"
   ```
   The answer must contain `"configured": true` and the model in use. In the app, the **Advice** screen no longer shows "Conseiller inactif".

**Models.** The advisor uses `ADVISOR_MODEL` (default `claude-sonnet-5-5`) for analyses; the savings strategy document is written by `STRATEGY_MODEL` (default `claude-opus-5-5`). Both can be changed in `.env`. Known prices are those of the models listed in `services/advisor/app/main.py`; an unknown model is counted at the highest rate, as a precaution, when computing the cap.

**Budget cap.** API spend for the current calendar month is measured (table `api_usage`) and shown at the top of the **Advice** screen. The monthly cap is **$5** by default (setting `advisor_monthly_budget_usd`): before each call the advisor refuses to start if the month's spend plus the maximum estimated cost of one analysis (about $0.30) would exceed the cap. To change it, for example to $10:

```bash
docker compose exec postgres psql -U patrimoine -c "UPDATE settings SET value = 10 WHERE key = 'advisor_monthly_budget_usd';"
```

Also set a spending limit in the Anthropic console: it is the provider-side safety net.

**Triggers.** The "Demander un avis" button runs an analysis on demand (1 to 2 minutes); analyses also start on their own on specific facts (end of pay cycle, cap exceeded, goal out of reach...). The strategy document is written on demand (about $0.30).

## 5. Banks, e-mail, notifications

Everything is optional and set in `.env`, then `docker compose up -d`.

- **Banks (Enable Banking).** Official PSD2 APIs, free restricted access to your own accounts. Create an application at <https://enablebanking.com/cp/> (Production, restricted mode), put the private key in `secrets/enablebanking.pem`, set `EB_APP_ID`, then authorise each bank from the **Banks** screen. Step by step, commands and consent renewal (about 180 days): [deployment](deploiement.md#connecter-ses-banques-enable-banking) (in French). Synchronisation is a job: `docker compose --profile jobs run --rm ingestion-bank`, or `scripts/sync.sh` from cron, or the `systemd` timers in `deploy/systemd/`.
- **E-mail (monthly digest).** Set `SMTP_HOST`, `SMTP_PORT` (587 by default), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` and `APP_URL` (address used in links). With Gmail: `smtp.gmail.com` and an app password. Each person receives the digest at the address set on the **Alerts** screen. Send now: `docker compose exec reporting python -m app.main --send`; monthly sending: `deploy/systemd/patrimoine-digest.timer`.
- **ntfy notifications.** `NTFY_TOPIC` (the topic name acts as a password: make it long and random; `setup.sh` generates one), `NTFY_URL` (default `https://ntfy.sh`, or your own server) and optionally `NTFY_TOKEN`. Subscribe your phone to the topic in the ntfy app. Test: `curl -X POST http://localhost:8000/alerts/test` should deliver "Patrimoine : test".
- **Market prices** (optional): `TWELVEDATA_API_KEY` and `FRED_API_KEY`, both free.

## 6. Desktop app

A dedicated window for Windows and Linux that connects to your server: see [application-bureau.md](application-bureau.md) (in French: download, SHA-256 check, SmartScreen warning).

## 7. Backup and update

```bash
# database backup
docker compose exec -T postgres pg_dump -U patrimoine -d patrimoine -Fc > patrimoine-$(date +%F).dump
# update
git pull && docker compose up -d --build
```

Also back up `.env` and `secrets/` (Enable Banking key) to an encrypted place off the machine. The ledger applies the migrations in `db/migrations/` automatically at startup: take a backup before every update. Restore and troubleshooting: [installation](installation.en.md#backup-and-restore).

Reminder: there are no user accounts; put an authenticating reverse proxy in front before exposing the app ([installation](installation.en.md#authentication-put-it-in-front)).
