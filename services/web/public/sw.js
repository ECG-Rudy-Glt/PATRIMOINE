// Service worker Patrimoine : coque de l'interface + notifications Web Push.
// Données bancaires jamais mises en cache : /api/*, /ha/*, l'outpost Authentik et les pages HTML passent toujours par le réseau ;
// hors ligne, une page « Hors connexion » sans aucun chiffre. Changer CACHE purge l'ancien cache à l'activation.
const CACHE = "patrimoine-v1";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon.svg", "/manifest.webmanifest"];
const NEVER = ["/api/", "/ha/", "/_ha", "/outpost.goauthentik.io/"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (NEVER.some((p) => url.pathname.startsWith(p))) return;
  if (req.mode === "navigate") {
    // HTML toujours frais (et redirection SSO si la session a expiré) ; hors ligne : page sans données
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  // Fichiers Vite (/assets/*, nom haché donc immuables) et icônes : cache d'abord
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});

// --- Web Push ------------------------------------------------------------------------------------------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Patrimoine", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/", location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === location.origin) { await w.focus(); return w.navigate(target).catch(() => undefined); }
    }
    return self.clients.openWindow(target);
  })());
});

// Abonnement renouvelé par le navigateur (rare) : on réenregistre le nouveau auprès du ledger
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const { public_key } = await fetch("/api/push/key").then((r) => r.json());
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: public_key });
    await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
  })());
});
