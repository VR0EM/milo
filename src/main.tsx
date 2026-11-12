import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { MiniTimer } from "./features/today/MiniTimer";
import { files, onDataChanged, windowKind } from "./lib/api";
import "./styles.css";

// Local database: data never goes stale on its own, so no background refetching.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
});

// The background calendar sync tells the window when it changed something.
onDataChanged(() => queryClient.invalidateQueries());

// Browser preview only: `?demo` fills the stand-in with a sample week before the first render.
const demo = !files.available && new URLSearchParams(location.search).has("demo")
  ? import("./lib/demoData").then((m) => m.seedDemo())
  : Promise.resolve();

await demo;
const kind = await windowKind();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {kind === "focus-mini" ? <MiniTimer /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>,
);
