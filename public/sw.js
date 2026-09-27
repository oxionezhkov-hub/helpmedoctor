// Service worker приложения: показывает пуш-уведомления и открывает нужный экран по нажатию.
// Кэша нет — приложение всегда берёт свежие файлы с сервера.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Help me, Doctor", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "/app" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/app", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = wins.find((w) => new URL(w.url).pathname.startsWith("/app"));
    if (app) {
      await app.focus();
      return app.navigate ? app.navigate(url) : undefined;
    }
    return self.clients.openWindow(url);
  })());
});
