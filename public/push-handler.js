// Imported into the Workbox service worker (see vite.config.ts): shows expiry
// reminders and opens the app on tap.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const { title = "Larder", body = "", tag = "larder", url = "/" } = payload;
  event.waitUntil(self.registration.showNotification(title, { body, tag, icon: "/icon-192.png", data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        await client.focus();
        await client.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
