// An AI app connected through MCP (see src-tauri/src/mcp.rs) writes to the same database from
// another program. SQLite counts such outside writes in `PRAGMA data_version`; when it moves,
// everything on screen is fetched again. Only while the window is visible, and very cheap.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, inDesktop } from "./api";

const EVERY_MS = 2000;

export function useOutsideChanges() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!inDesktop) return;
    let last: number | null = null;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const v = await api.dataVersion();
        if (last !== null && v !== last) qc.invalidateQueries();
        last = v;
      } catch {
        // A busy moment: try again at the next tick.
      }
    };
    check();
    const t = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [qc]);
}
