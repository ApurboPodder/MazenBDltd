const CACHE_PREFIX = "mazen-eyewear-pwa-";
const CACHE_NAME = CACHE_PREFIX + "v11";
const APP_FILES = [
  "./",
  "./index.html",
  "./glb-studio.html",
  "./gallery.html",
  "./project.html",
  "./configurator.html",
  "./multi-configurator.html",
  "./image-converter.html",
  "./try-on.html",
  "./admin.html",
  "./manifest.webmanifest",
  "./style.css",
  "./home.css",
  "./glb-studio.css",
  "./gallery.css",
  "./project.css",
  "./configurator.css",
  "./multi-configurator.css",
  "./image-converter.css",
  "./try-on.css",
  "./admin.css",
  "./theme.css",
  "./theme.js",
  "./home.js",
  "./glb-studio.js",
  "./gallery.js",
  "./project.js",
  "./project-viewer.js",
  "./project-discovery.js",
  "./app.js",
  "./multi-configurator.js",
  "./image-converter.js",
  "./try-on.js",
  "./admin.js",
  "./assets/Logo/Mazen%20Logo.png",
  "./icons/eyewear-icon-192.png",
  "./icons/eyewear-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    refresh.catch(() => {});
    return cached;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  if (/\.glb$/i.test(url.pathname)) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
