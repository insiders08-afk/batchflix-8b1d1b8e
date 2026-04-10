import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./App.css";
import { prefetchCriticalRoutes } from "./lib/prefetchRoutes";

createRoot(document.getElementById("root")!).render(<App />);

// Start prefetching chat & dashboard chunks once the main thread is idle
prefetchCriticalRoutes();
