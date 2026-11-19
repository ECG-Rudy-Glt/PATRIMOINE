# Patrimoine, application de bureau

Coque [Tauri v2](https://tauri.app/) légère (quelques Mo) : une fenêtre dédiée qui ouvre **votre** serveur Patrimoine. Elle n'embarque ni l'application ni vos données.

- **Premier lancement** : un écran local (français / anglais) demande l'adresse du serveur, la valide (https, ou http pour un serveur du réseau local), teste qu'il répond, puis l'ouvre.
- L'adresse est mémorisée dans le dossier de configuration de l'utilisateur (`config.json` : `%APPDATA%\org.patrimoine.desktop` sous Windows, `~/Library/Application Support/org.patrimoine.desktop` sous macOS, `~/.config/org.patrimoine.desktop` sous Linux).
- Menu **Serveur > Changer de serveur…** pour revenir à l'écran de saisie.
- Les liens vers un autre site s'ouvrent dans le navigateur par défaut.
- Pas de mode hors ligne ni de notifications de bureau : l'application a besoin de joindre le serveur.
- Aucune adresse n'est codée en dur. Le contenu distant n'a accès à aucune API native (capacité `core:default` limitée à l'écran local).

Pour télécharger l'application sans la compiler : [docs/application-bureau.md](../docs/application-bureau.md).

## Prérequis de compilation

- [Node.js](https://nodejs.org/) 20 ou plus, [Rust](https://rustup.rs/) 1.77 ou plus.
- Windows : Microsoft C++ Build Tools et WebView2 (présent sous Windows 10/11). macOS : Xcode Command Line Tools. Linux (Debian/Ubuntu) :
  `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl`.
  Détails : <https://v2.tauri.app/start/prerequisites/>.

## Compiler en local

```bash
cd desktop
npm ci
npm run tauri dev                        # fenêtre de développement
npm run tauri build                      # installateurs de votre système, dans src-tauri/target/release/bundle/
npm run tauri build -- --bundles nsis    # un seul format (msi, nsis, dmg, appimage, deb)
cargo test --manifest-path src-tauri/Cargo.toml   # tests de validation d'adresse
```

Seul le système courant peut être compilé : Windows pour `.msi` / `.exe`, macOS pour `.dmg`, Linux pour AppImage / `.deb`. La publication multi-plateforme passe par GitHub Actions.

## Icônes

`icon-source.png` (512 px, monogramme P) sert de source :

```bash
npm run icons     # régénère src-tauri/icons/ (png, ico, icns)
```

## Publier une version (GitHub Actions)

Le workflow [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) construit Windows (msi + exe NSIS), macOS (dmg Apple Silicon et Intel) et Linux (AppImage + deb), puis crée une Release GitHub avec `SHA256SUMS.txt`.

1. Mettez à jour `version` dans `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`.
2. Créez et poussez le tag : `git tag desktop-v0.1.0 && git push origin desktop-v0.1.0`.
3. Ou lancez le workflow à la main (onglet *Actions*) : sans « publier », les installateurs restent en artefacts pendant 14 jours.

Les actions sont épinglées par version et les permissions sont minimales (lecture seule, sauf le job de publication).

## Signature (optionnelle)

Par défaut, les installateurs **ne sont pas signés**. Pour les signer, ajoutez ces secrets dans *Settings > Secrets and variables > Actions* : le workflow les détecte et signe automatiquement ; sans eux il construit des installateurs non signés.

| Plateforme | Secrets | Remarque |
|---|---|---|
| Windows | `WINDOWS_CERTIFICATE` (fichier `.pfx` encodé en base64), `WINDOWS_CERTIFICATE_PASSWORD` | Certificat de signature de code (OV ou EV). Voir <https://v2.tauri.app/distribute/sign/windows/>. |
| macOS | `APPLE_CERTIFICATE` (`.p12` en base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (mot de passe d'application), `APPLE_TEAM_ID` | Compte Apple Developer payant (signature et notarisation). Voir <https://v2.tauri.app/distribute/sign/macos/>. |
| Linux | aucun | Pas de signature requise. |

## Structure

```
desktop/
  src/               écran de premier lancement (HTML, CSS, JS sans dépendance)
  src-tauri/         coque Rust : mémorisation de l'adresse, menu, filtre de navigation
  icon-source.png    icône source
```
