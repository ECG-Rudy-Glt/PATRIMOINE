# Installation

This guide installs Patrimoine on your computer or server with two commands. [Version française](installation.md).

## Requirements

- **Docker** with **Docker Compose v2** ([install Docker](https://docs.docker.com/get-docker/)). On Windows and macOS: Docker Desktop.
- **Git** and **openssl** (usually present on Linux and macOS; on Windows, `setup.ps1` does not need openssl).
- About 2 GB of free RAM and 3 GB of disk space.

## Two-command install

```bash
git clone https://github.com/ECG-Rudy-Glt/PATRIMOINE.git && cd PATRIMOINE
./scripts/setup.sh && docker compose up -d --build
```

On Windows (PowerShell):

```powershell
git clone https://github.com/ECG-Rudy-Glt/PATRIMOINE.git; cd PATRIMOINE
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
docker compose up -d --build
```

The setup assistant:

- generates random passwords and writes `.env` (restricted permissions, never committed);
- asks five **optional** questions (public address, AI advisor, e-mail, ntfy notifications, banks). Press Enter to skip: everything can be changed later in `.env`;
- never displays the secrets you type;
- is safe to re-run: an existing `.env` keeps its passwords;
- accepts `--yes` (PowerShell: `-Yes`) for a question-free install, e.g. for automation.

The first build takes a few minutes. The interface and the AI advisor prompts are currently in French.

## First sign-in

1. Open <http://localhost:8080>.
2. The app starts with two sample people, *Alex* and *Sam*. Rename them in SQL: `docker compose exec postgres psql -U patrimoine -c "UPDATE persons SET name = 'Your name' WHERE id = 1;"`.
3. Add your accounts: import a statement (CSV or OFX) from the **Export** screen ("Importer un historique"), or connect your banks (**Banques** screen, see [deployment](deploiement.md), in French).
4. Quick check: `curl http://localhost:8000/health` must answer `{"status":"ok"}`.

There are **no user accounts**: see "Authentication" below.

## Authentication: put it in front

Patrimoine has no built-in login. Ports are bound to `127.0.0.1`, so the app is only reachable from the host. To use it from another device or from the Internet, put a **reverse proxy that authenticates** in front of port 8080 (Caddy, Traefik or nginx with basic auth, or an SSO such as Authentik). Never expose the ports as they are: the app holds your financial data. Also encrypt the machine's disk.

## Updating

```bash
git pull
docker compose up -d --build
```

Database migrations are applied automatically at startup. Back up first (see below).

## Backup and restore

```bash
# backup
docker compose exec -T postgres pg_dump -U patrimoine -d patrimoine -Fc > patrimoine-$(date +%F).dump
# restore (on a clean install)
docker compose exec -T postgres pg_restore -U patrimoine -d patrimoine --clean --if-exists --no-owner < patrimoine-YYYY-MM-DD.dump
```

Also back up `.env` and the `secrets/` folder (Enable Banking key) somewhere encrypted, off the machine.

## Stop, start over

```bash
docker compose down        # stop, keep data
docker compose down -v     # stop AND erase data
```

## Troubleshooting

| Symptom | Hint |
|---|---|
| `docker: command not found` | Docker is not installed or not in PATH; restart the terminal. |
| The page does not open | `docker compose ps`: all services should be "running". Logs: `docker compose logs -f ledger web`. |
| Port 8080 (or 8000, 3000, 5432) already in use | Stop the other program, or change the left side of the `ports:` entry in `docker-compose.yml` (e.g. `127.0.0.1:8081:80`). |
| `password authentication failed` after deleting `.env` | The database keeps the old password. Restore the old `.env`, or start over with `docker compose down -v` (erases data). |
| All figures are zero | No account imported yet: import a statement or connect a bank. |
| AI advisor unavailable | `ANTHROPIC_API_KEY` is missing from `.env`: re-run `./scripts/setup.sh` or edit `.env`, then `docker compose up -d`. |
| Windows: `setup.ps1` blocked | Run it with `powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1`. |

Still stuck? Open an issue with the logs attached (no personal data or secrets).
