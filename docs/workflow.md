# Workflow de développement

## Environnement local

```bash
./scripts/setup.sh                 # .env avec des secrets aléatoires
docker compose up -d --build       # toute l'application
docker compose logs -f ledger      # suivre un service
```

L'interface se développe à part, avec rechargement à chaud :

```bash
cd services/web
npm install
API_TARGET=http://localhost:8000 npm run dev
```

## Tests

```bash
./scripts/test.sh
```

Le script ne nécessite pas de réseau applicatif et enchaîne :

1. les tests unitaires de chaque service Python (`ledger`, `advisor`, `budget-engine`, `reporting`, `allocation-engine`, `ingestion-bank`), dans un conteneur `python:3.12-slim` ;
2. l'application de toutes les migrations SQL sur un PostgreSQL jetable ;
3. l'appel des fonctions SQL clés (budget, quotes-parts, récurrences, catégorisation, rapports).

Le même script tourne dans la CI GitHub à chaque *push* et *pull request* (`.github/workflows/ci.yml`).

## Migrations

- Ajoutez un fichier `db/migrations/NNN_description.sql` (numéro suivant, jamais de modification d'un fichier déjà publié).
- Écrivez-le de façon idempotente quand c'est possible (`IF NOT EXISTS`).
- Le `ledger` l'applique au démarrage, dans sa propre transaction, et le consigne dans `schema_migrations`.
- Vérifiez avec `./scripts/test.sh` : toutes les migrations sont rejouées sur une base vide.

## Contrôle de qualité

- Aucun secret dans le dépôt : `.env` et `secrets/` sont ignorés. En cas de doute, ne commitez pas.
- Les montants affichés viennent des services déterministes ; le conseiller IA ne calcule jamais un chiffre. Toute estimation est marquée « ≈ ».
- Un changement qui touche aux données financières doit être couvert par un test.

## Branches et revues

- `main` est la branche stable. Travaillez sur une branche et ouvrez une *pull request*.
- Une PR doit passer la CI avant d'être fusionnée.
- Messages de commit courts et au présent (par exemple `fix: arrondi du budget en fin de cycle`).
