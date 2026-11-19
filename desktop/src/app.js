// Écran de premier lancement : demande l'adresse du serveur, la valide, teste qu'elle répond, puis l'ouvre.
// La validation de référence est faite côté Rust (commande test_server) ; ici on ne fait que l'affichage.
(function () {
  "use strict";
  var T = {
    fr: {
      title: "Connexion à votre serveur", lead: "Saisissez l'adresse de votre serveur Patrimoine. Elle est mémorisée sur cet ordinateur.",
      label: "Adresse du serveur", connect: "Se connecter", hint: "https est requis, sauf pour un serveur du réseau local (localhost, 192.168.x.x, 10.x.x.x, nom en .local).",
      other: "English", testing: "Test de la connexion…", ok: "Serveur joignable, ouverture…", empty: "Saisissez l'adresse du serveur."
    },
    en: {
      title: "Connect to your server", lead: "Enter the address of your Patrimoine server. It is remembered on this computer.",
      label: "Server address", connect: "Connect", hint: "https is required, except for a local-network server (localhost, 192.168.x.x, 10.x.x.x, .local name).",
      other: "Français", testing: "Testing the connection…", ok: "Server reachable, opening…", empty: "Enter the server address."
    }
  };
  var lang = "fr";
  try { lang = localStorage.getItem("lang") || (navigator.language || "fr").slice(0, 2); } catch (e) { lang = (navigator.language || "fr").slice(0, 2); }
  if (!T[lang]) lang = "en";

  var $ = function (id) { return document.getElementById(id); };
  var msg = $("msg"), input = $("url"), go = $("go");

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = T[lang][el.getAttribute("data-i18n")]; });
    $("lang").textContent = T[lang].other;
  }
  function say(text, cls) { msg.textContent = text || ""; msg.className = "msg" + (cls ? " " + cls : ""); }
  function invoke(cmd, args) {
    var t = window.__TAURI__ && window.__TAURI__.core;
    return t ? t.invoke(cmd, args) : Promise.reject("Tauri indisponible");
  }

  $("lang").addEventListener("click", function () {
    lang = lang === "fr" ? "en" : "fr";
    try { localStorage.setItem("lang", lang); } catch (e) { /* sans stockage : tant pis */ }
    apply(); say("");
  });

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var value = input.value.trim();
    if (!value) { say(T[lang].empty, "err"); return; }
    go.disabled = true; say(T[lang].testing);
    invoke("test_server", { url: value, lang: lang }).then(function (normalized) {
      say(T[lang].ok, "ok");
      return invoke("save_and_open", { url: normalized });
    }).catch(function (e) { say(String(e), "err"); go.disabled = false; });
  });

  apply();
  invoke("get_server").then(function (url) { if (url) input.value = url; }).catch(function () { });
})();
