/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, setCatchHandler, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate, NetworkOnly } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { BackgroundSyncPlugin } from "workbox-background-sync";

declare let self: ServiceWorkerGlobalScope;

// Workbox precache manifest injected at build time — handles versioned /assets/* chunks
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── SPA navigation fallback: serve index.html from precache for all routes ──
// Without this, deep-link refreshes while offline show the browser's offline page.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /\/_/, /\.[^\/]+$/], // skip API, internal, and asset paths
  })
);

// ─── Runtime caching: JS/CSS assets (cache-first, 1 year) ────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith("/assets/"),
  new CacheFirst({
    cacheName: "assets-cache-v1",
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        maxEntries: 100,
      }),
    ],
  })
);

// ─── Runtime caching: Google Fonts stylesheets (stale-while-revalidate) ──────
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({
    cacheName: "google-fonts-stylesheets-v1",
    plugins: [
      new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 10 }),
    ],
  })
);

// ─── Runtime caching: Google Fonts files (cache-first, 1 year) ───────────────
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "google-fonts-webfonts-v1",
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 365 * 24 * 60 * 60,
        maxEntries: 20,
      }),
    ],
  })
);

// ─── Runtime caching: Supabase Storage media (cache-first, 30 days) ──────────
// Caches avatars, chat attachments, homework files so they render offline.
registerRoute(
  ({ url }) =>
    url.host.includes("supabase.co") &&
    url.pathname.includes("/storage/v1/object/public/"),
  new CacheFirst({
    cacheName: "supabase-media-v1",
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        maxEntries: 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ─── Route: Supabase DM INSERT requests → background-sync queue ──────────────
// Intercepts POST/PATCH requests to Supabase REST for direct_messages table.
// Network-first: if online, fires normally. If offline, queued for later sync.
registerRoute(
  ({ url, request }) =>
    url.hostname.includes("supabase") &&
    url.pathname.includes("direct_messages") &&
    (request.method === "POST" || request.method === "PATCH"),
  new NetworkOnly({
    plugins: [new BackgroundSyncPlugin("bh-dm-messages", { maxRetentionTime: 24 * 60 })],
  }),
  "POST"
);

registerRoute(
  ({ url, request }) =>
    url.hostname.includes("supabase") &&
    url.pathname.includes("batch_messages") &&
    (request.method === "POST" || request.method === "PATCH"),
  new NetworkOnly({
    plugins: [new BackgroundSyncPlugin("bh-batch-messages", { maxRetentionTime: 24 * 60 })],
  }),
  "POST"
);

// ─── Push notification handler ───────────────────────────────────────────────
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  let payload: { title?: string; body?: string; url?: string; icon?: string } = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "New Announcement", body: event.data.text() };
  }

  const title = payload.title || "BatchHub";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: payload.icon || "/icons/pwa-192x192.png",
    badge: "/icons/pwa-192x192.png",
    data: { url: payload.url || "/" },
    requireInteraction: false,
    tag: "batchhub-announcement",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click handler ──────────────────────────────────────────────
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const targetUrl: string = (event.notification.data?.url as string) || "/";

  event.waitUntil(
    (self.clients as Clients).matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          (client as WindowClient).navigate(targetUrl);
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
