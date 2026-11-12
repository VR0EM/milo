// Updates from GitHub Releases (see .github/workflows/release.yml). Milo only asks GitHub which
// version is newest; nothing about the user is sent. Installing happens only after a click.

import { create } from "zustand";
import { files } from "./api";

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

interface UpdateState {
  available: { version: string; notes: string } | null;
  status: "idle" | "checking" | "installing" | "up-to-date" | "error";
  progress: number | null;
  error: string | null;
}

export const useUpdates = create<UpdateState>(() => ({
  // Browser preview only: `?update` shows how a waiting update looks.
  available: !files.available && new URLSearchParams(location.search).has("update") ? { version: "0.3.0", notes: "" } : null,
  status: "idle",
  progress: null,
  error: null,
}));

let pending: Update = null;
const CHECKED_KEY = "milo-update-checked";
const AUTO_INTERVAL = 20 * 3600_000;

/** Asks GitHub whether a newer Milo exists. `quiet`: no error shown (the automatic check). */
export async function checkForUpdate(quiet = false) {
  if (!files.available) return;
  useUpdates.setState({ status: "checking", error: null });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
    useUpdates.setState({
      available: pending ? { version: pending.version, notes: pending.body ?? "" } : null,
      status: pending ? "idle" : "up-to-date",
    });
  } catch (e) {
    const text = String(e);
    // The plugin's wording for "no latest.json there": no release yet, or no internet.
    const readable = /valid release JSON|404|error sending request/i.test(text)
      ? "no published version was found (or there is no internet connection)"
      : text;
    useUpdates.setState({ status: quiet ? "idle" : "error", error: quiet ? null : readable });
  }
}

/** The automatic check: at most once every 20 hours, silent when offline. */
export function checkAutomatically() {
  const last = Number(localStorage.getItem(CHECKED_KEY) ?? 0);
  if (Date.now() - last > AUTO_INTERVAL) checkForUpdate(true);
}

/** Downloads and installs the update, then restarts Milo. Data stays where it is. */
export async function installUpdate() {
  if (!pending) return;
  useUpdates.setState({ status: "installing", progress: null, error: null });
  try {
    let total = 0;
    let received = 0;
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        received += event.data.chunkLength;
        useUpdates.setState({ progress: total ? received / total : null });
      }
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdates.setState({ status: "error", error: String(e) });
  }
}
