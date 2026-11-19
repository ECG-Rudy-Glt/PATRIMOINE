//! Coque de bureau Patrimoine : une fenêtre dédiée qui ouvre le serveur Patrimoine de l'utilisateur.
//!
//! - Premier lancement : page locale (`src/index.html`) qui demande l'adresse du serveur.
//! - L'adresse est mémorisée dans le dossier de configuration de l'utilisateur (`config.json`).
//! - Menu « Serveur > Changer de serveur » : retour à la page locale.
//! - Les liens vers un autre site s'ouvrent dans le navigateur par défaut.
//! - Aucune adresse n'est codée en dur ; le contenu distant n'a accès à aucune API native.

use std::{fs, path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const WINDOW: &str = "main";

#[derive(Serialize, Deserialize, Default)]
struct Config {
    server: Option<String>,
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let path = config_path(app).ok_or("dossier de configuration introuvable")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Vrai pour localhost, une adresse IP privée/loopback, un nom sans point ou un nom en .local / .lan / .home.arpa.
fn is_local_host(host: &str) -> bool {
    let h = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    if h == "localhost" || h == "::1" || h.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = h.parse::<std::net::Ipv4Addr>() {
        return ip.is_loopback() || ip.is_private() || ip.is_link_local();
    }
    if let Ok(ip) = h.parse::<std::net::Ipv6Addr>() {
        let seg = ip.segments();
        return ip.is_loopback() || (seg[0] & 0xfe00) == 0xfc00 || (seg[0] & 0xffc0) == 0xfe80;
    }
    !h.contains('.') || h.ends_with(".local") || h.ends_with(".lan") || h.ends_with(".home.arpa")
}

/// Normalise et valide l'adresse saisie. Messages en français ou en anglais selon `lang`.
fn normalize(input: &str, lang: &str) -> Result<Url, String> {
    let fr = lang != "en";
    let msg = |f: &'static str, e: &'static str| if fr { f.to_string() } else { e.to_string() };
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(msg("Adresse vide.", "Empty address."));
    }
    // Sans schéma : https par défaut.
    let with_scheme = if trimmed.contains("://") { trimmed.to_string() } else { format!("https://{trimmed}") };
    let mut url = Url::parse(&with_scheme).map_err(|_| msg("Adresse invalide.", "Invalid address."))?;
    match url.scheme() {
        "https" => {}
        "http" => {
            let host = url.host_str().unwrap_or("");
            if !is_local_host(host) {
                return Err(msg(
                    "http n'est accepté que pour un serveur du réseau local. Utilisez https.",
                    "http is only accepted for a local-network server. Use https.",
                ));
            }
        }
        _ => return Err(msg("Seuls http et https sont acceptés.", "Only http and https are accepted.")),
    }
    if url.host_str().map_or(true, str::is_empty) {
        return Err(msg("Adresse invalide.", "Invalid address."));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(msg("N'incluez pas d'identifiants dans l'adresse.", "Do not include credentials in the address."));
    }
    url.set_fragment(None);
    Ok(url)
}

/// URL de la page locale (écran de choix du serveur).
fn local_url() -> Url {
    let s = if cfg!(windows) { "http://tauri.localhost/index.html" } else { "tauri://localhost/index.html" };
    Url::parse(s).expect("URL locale valide")
}

fn is_local_page(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost")) || url.host_str() == Some("tauri.localhost")
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

#[tauri::command]
fn get_server(app: AppHandle) -> Option<String> {
    load_config(&app).server
}

/// Valide l'adresse et vérifie que le serveur répond. Toute réponse HTTP (même 401/403 d'un proxy
/// d'authentification) prouve que le serveur est joignable.
#[tauri::command]
async fn test_server(url: String, lang: Option<String>) -> Result<String, String> {
    let lang = lang.unwrap_or_else(|| "fr".into());
    let fr = lang != "en";
    let parsed = normalize(&url, &lang)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    match client.get(parsed.clone()).send().await {
        Ok(_) => Ok(parsed.to_string()),
        Err(e) if e.is_timeout() => Err(if fr { "Le serveur ne répond pas (délai dépassé).".into() } else { "The server does not respond (timeout).".into() }),
        Err(e) if e.is_connect() => Err(if fr { "Impossible de se connecter à ce serveur. Vérifiez l'adresse et le réseau.".into() } else { "Cannot connect to this server. Check the address and your network.".into() }),
        Err(_) => Err(if fr { "Le serveur est injoignable ou son certificat est invalide.".into() } else { "The server is unreachable or its certificate is invalid.".into() }),
    }
}

/// Mémorise l'adresse (déjà testée) et ouvre le serveur dans la fenêtre.
#[tauri::command]
fn save_and_open(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = normalize(&url, "fr")?;
    save_config(&app, &Config { server: Some(parsed.to_string()) })?;
    let win = app.get_webview_window(WINDOW).ok_or("fenêtre introuvable")?;
    win.navigate(parsed).map_err(|e| e.to_string())
}

fn open_window(app: &AppHandle) -> tauri::Result<()> {
    let saved = load_config(app).server.and_then(|s| Url::parse(&s).ok());
    let initial = match &saved {
        Some(u) => WebviewUrl::External(u.clone()),
        None => WebviewUrl::App("index.html".into()),
    };
    let handle = app.clone();
    // Les liens target=_blank et window.open sont ramenés dans la fenêtre : le filtre de navigation
    // ci-dessous décide ensuite s'ils restent ici (même serveur) ou partent dans le navigateur.
    let init_script = r#"
      (function () {
        document.addEventListener('click', function (e) {
          var a = e.target && e.target.closest && e.target.closest('a[target="_blank"]');
          if (a && a.href) { e.preventDefault(); window.location.href = a.href; }
        }, true);
        window.open = function (u) { if (u) { window.location.href = String(u); } return null; };
      })();
    "#;
    WebviewWindowBuilder::new(app, WINDOW, initial)
        .title("Patrimoine")
        .inner_size(1280.0, 820.0)
        .min_inner_size(380.0, 600.0)
        .initialization_script(init_script)
        .on_navigation(move |url| {
            if is_local_page(url) || url.scheme() == "about" || url.scheme() == "blob" || url.scheme() == "data" {
                return true;
            }
            let server = load_config(&handle).server.and_then(|s| Url::parse(&s).ok());
            if let Some(s) = server {
                if same_origin(&s, url) {
                    return true;
                }
            }
            // Autre site : navigateur par défaut (http/https/mailto uniquement), jamais dans la fenêtre.
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = handle.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_server, test_server, save_and_open])
        .setup(|app| {
            let change = MenuItemBuilder::with_id("change_server", "Changer de serveur… / Change server…").build(app)?;
            let reload = MenuItemBuilder::with_id("reload", "Recharger / Reload").accelerator("CmdOrCtrl+R").build(app)?;
            let server_menu = SubmenuBuilder::new(app, "Serveur / Server")
                .item(&change)
                .item(&reload)
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Édition / Edit")
                .undo().redo().separator().cut().copy().paste().select_all()
                .build()?;
            let menu = MenuBuilder::new(app).items(&[&server_menu, &edit_menu]).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if let Some(win) = app.get_webview_window(WINDOW) {
                    match event.id().as_ref() {
                        "change_server" => { let _ = win.navigate(local_url()); }
                        "reload" => { let _ = win.eval("window.location.reload()"); }
                        _ => {}
                    }
                }
            });
            open_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Patrimoine");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_par_defaut() {
        assert_eq!(normalize("patrimoine.example.org", "fr").unwrap().as_str(), "https://patrimoine.example.org/");
    }
    #[test]
    fn http_refuse_hors_reseau_local() {
        assert!(normalize("http://patrimoine.example.org", "fr").is_err());
        assert!(normalize("http://8.8.8.8", "fr").is_err());
    }
    #[test]
    fn http_accepte_en_local() {
        for u in ["http://localhost:8080", "http://192.168.1.20:8080", "http://10.1.2.3", "http://nas.local", "http://serveur", "http://172.16.0.5"] {
            assert!(normalize(u, "fr").is_ok(), "{u}");
        }
        assert!(normalize("http://172.32.0.5", "fr").is_err());
    }
    #[test]
    fn schemas_et_identifiants_refuses() {
        assert!(normalize("ftp://exemple.org", "fr").is_err());
        assert!(normalize("https://user:pass@exemple.org", "fr").is_err());
        assert!(normalize("", "fr").is_err());
    }
}
