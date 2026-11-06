# Politique de sécurité

Patrimoine manipule des données financières personnelles : la sécurité compte. Merci de signaler toute faille de façon responsable.

## Signaler une vulnérabilité

Ne créez **pas** d'issue publique. Utilisez le signalement privé de GitHub (onglet *Security* → *Report a vulnerability*) du dépôt `ECG-Rudy-Glt/PATRIMOINE`. Décrivez le problème, les étapes pour le reproduire et son impact. Une réponse est donnée dès que possible.

## Ce que le projet fait

- Les **identifiants bancaires ne sont jamais stockés** : ils sont saisis chez la banque. Le projet ne conserve que la session d'accès en lecture seule fournie par Enable Banking (`secrets/sessions.json`).
- Les **secrets** (mots de passe, clés d'API, clé privée Enable Banking) vivent dans `.env` et `secrets/`, tous deux ignorés par git.
- Les **ports** du `docker-compose.yml` sont liés à `127.0.0.1`.
- Les citations du conseiller IA sont **vérifiées par le serveur** : une recommandation qui cite un fait inexistant est rejetée.

## Ce que le projet ne fait pas (à votre charge)

- **Pas d'authentification intégrée** : placez l'application derrière un reverse proxy qui authentifie (SSO, authentification de base au minimum). Ne l'exposez jamais directement sur Internet.
- **Pas de chiffrement des données au repos** : chiffrez le disque ou le volume qui héberge la base et les sauvegardes.
- **Sauvegardes** : à planifier et à chiffrer (voir [docs/deploiement.md](docs/deploiement.md)).
- **Services externes** : si vous activez le conseiller IA, les faits chiffrés nécessaires à la réponse sont envoyés au fournisseur du modèle de langage choisi (aujourd'hui Anthropic).

## Bonnes pratiques

- Mettez à jour régulièrement les images et dépendances.
- Limitez l'accès réseau à l'application et à la base.
- Ne commitez jamais `.env`, `secrets/` ni une sauvegarde de la base.

## Avertissement

Patrimoine est un outil d'aide à la décision, pas un conseil en investissement. Les recommandations sont des propositions que vous validez vous-même ; rien n'est exécuté automatiquement.
