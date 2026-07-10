const CACHE_NAME = "terrapulse-dashboard-real-final-v4";
const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./firebase-config.js",
    "./manifest.json",
    "./icon.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.map((key) => key !== CACHE_NAME ? caches.delete(key) : null)))
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (
        url.hostname.includes("firebaseio.com") ||
        url.hostname.includes("googleapis.com") ||
        url.hostname.includes("gstatic.com") ||
        url.hostname.includes("jsdelivr.net") ||
        url.hostname.includes("fonts.googleapis.com") ||
        url.hostname.includes("fonts.gstatic.com")
    ) return;

    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
        }).catch(() => caches.match("./index.html")))
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = event.notification?.data?.url || "./index.html#alerts";
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && "focus" in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
            return null;
        })
    );
});
