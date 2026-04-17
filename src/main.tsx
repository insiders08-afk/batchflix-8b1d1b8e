import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./App.css";
import { prefetchCriticalRoutes } from "./lib/prefetchRoutes";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

createRoot(document.getElementById("root")!).render(<App />);

// Start prefetching chat & dashboard chunks once the main thread is idle
prefetchCriticalRoutes();

// ─── Service worker registration with "Update available" toast ──────────────
// In preview iframes / lovable preview hosts the SW is intentionally disabled
// to avoid stale builds during development.
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (isPreviewHost || isInIframe) {
  navigator.serviceWorker?.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
} else {
  const updateSW = registerSW({
    onNeedRefresh() {
      toast("Update available", {
        description: "A new version of BatchHub is ready.",
        duration: Infinity,
        action: {
          label: "Refresh",
          onClick: () => updateSW(true),
        },
      });
    },
    onOfflineReady() {
      // Optional: silent — the offline banner already covers connectivity UX.
    },
  });
}
