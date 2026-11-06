# Contribuer à Patrimoine

Le projet est **ouvert et en construction** : les idées, retours et contributions sont les bienvenus.

## Avant de commencer

1. Ouvrez une *issue* pour discuter d'un changement important avant de coder.
2. Lisez [docs/architecture.md](docs/architecture.md) et [docs/workflow.md](docs/workflow.md).

## Proposer un changement

```bash
git clone https://github.com/ECG-Rudy-Glt/PATRIMOINE.git
cd PATRIMOINE
git checkout -b ma-fonctionnalite
./scripts/setup.sh && docker compose up -d --build
# ... modifications ...
./scripts/test.sh                 # doit passer
git commit -m "feat: ma fonctionnalité"
```

Ouvrez ensuite une *pull request* vers `main`. La CI doit passer.

## Règles

- **Aucune donnée personnelle ni secret** dans le code, les tests, les migrations ou les captures (utilisez des données fictives).
- **Un test** pour tout changement touchant aux calculs ou aux données financières.
- Le conseiller IA **n'invente jamais un chiffre** : les calculs restent dans les services déterministes.
- Les estimations sont signalées (« ≈ »).
- Les migrations SQL ne modifient jamais un fichier déjà publié : ajoutez un nouveau fichier numéroté.

## Domaines où l'aide est particulièrement utile

- Ouverture du conseiller à d'autres modèles de langage (API compatible OpenAI, modèles locaux).
- Généralisation du foyer à plus de deux personnes.
- Chiffrement des données au repos et durcissement.
- Nouveaux connecteurs bancaires, traductions, documentation.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous licence Apache 2.0.
