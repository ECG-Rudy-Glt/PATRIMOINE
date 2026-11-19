# Application de bureau

Une fenêtre dédiée pour Patrimoine sur Windows et Linux (pas de version macOS pour l'instant). Elle se connecte à **votre** serveur Patrimoine (voir [installation](installation.md)) : il faut donc qu'il soit joignable depuis l'ordinateur (réseau local, VPN ou reverse proxy avec authentification).

## Télécharger

Les installateurs sont publiés dans les [Releases GitHub](https://github.com/ECG-Rudy-Glt/PATRIMOINE/releases) du projet (tags `desktop-v…`) :

| Système | Fichier |
|---|---|
| Windows | `.msi` ou `…-setup.exe` (installateur NSIS) |
| Linux | `.AppImage` ou `.deb` |

## Vérifier l'intégrité (sommes SHA-256)

Chaque Release contient `SHA256SUMS.txt`. Après téléchargement, comparez :

```bash
# Linux / macOS (dans le dossier de téléchargement)
sha256sum -c SHA256SUMS.txt --ignore-missing        # macOS : shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows (PowerShell) : la valeur doit être identique à celle du fichier SHA256SUMS.txt
Get-FileHash .\Patrimoine_0.1.0_x64-setup.exe -Algorithm SHA256
```

Si les sommes diffèrent, ne lancez pas le fichier et re-téléchargez-le.

## Avertissement Windows SmartScreen (installateur non signé)

Les installateurs ne sont **pas signés** par défaut : une signature de code coûte un certificat payant. Windows SmartScreen affiche donc « Windows a protégé votre PC » pour un éditeur inconnu. Ce n'est pas une détection de virus.

Pour continuer, après avoir vérifié la somme SHA-256 ci-dessus : **Informations complémentaires**, puis **Exécuter quand même**. Le code source est public et l'installateur est construit par GitHub Actions à partir de ce dépôt. Si vous préférez, [compilez-le vous-même](../desktop/README.md).


## Linux

```bash
chmod +x Patrimoine_*.AppImage && ./Patrimoine_*.AppImage     # AppImage
sudo apt install ./patrimoine*.deb                              # Debian / Ubuntu
```

## Premier lancement

1. Saisissez l'adresse de votre serveur, par exemple `https://patrimoine.example.org` ou `http://192.168.1.20:8080`. Le français ou l'anglais se choisit sur l'écran.
2. Le bouton **Se connecter** teste que le serveur répond, puis ouvre Patrimoine. L'adresse est mémorisée sur l'ordinateur.
3. Pour changer de serveur : menu **Serveur > Changer de serveur…**.

Règles d'adresse : `https` est exigé, sauf pour un serveur du réseau local (`localhost`, `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`, nom en `.local`), où `http` est accepté. Si votre serveur est derrière un SSO ou une authentification de base, la page de connexion s'affiche dans la fenêtre.

Limites : pas de mode hors ligne, pas de notifications de bureau, et les liens vers d'autres sites s'ouvrent dans votre navigateur.

## Désinstaller

Windows : *Paramètres > Applications*. Linux : supprimez l'AppImage ou `sudo apt remove patrimoine`. La seule donnée locale est l'adresse du serveur (voir [desktop/README.md](../desktop/README.md)).
