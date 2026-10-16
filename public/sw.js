// Guarda o app no aparelho para abrir sem internet. As consultas ao Claude sempre vão para a rede.
const CACHE = "encarregado-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "db.js", "prompts.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro (para pegar atualizações), cache se estiver sem internet.
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).pathname.includes("/api/")) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("index.html")))
  );
});
