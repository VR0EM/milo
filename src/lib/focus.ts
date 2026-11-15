import { api } from "./api";
import { useUi } from "./store";
import type { FocusInput, FocusSession } from "./types";

/** Starts a focus session (and the small timer, if that is on). Used by every Start button. */
export async function beginFocus(input: FocusInput) {
  useUi.getState().setLastSpace(input.spaceId);
  const session = await api.startFocus(input);
  if (useUi.getState().prefs.focusMini) api.showFocusMini().catch(() => {});
  return session;
}

/** A session stopped within this time leaves nothing in the calendar (a click by mistake). */
export const FOCUS_MIN_MS = 60_000;

/**
 * Stops a session. One of under a minute is dropped: it would leave a sliver of an event, and
 * a planned block it was started from would shrink to those seconds. Returns whether it was kept.
 */
export async function endFocus(session: FocusSession, now = Date.now()): Promise<boolean> {
  if (now - new Date(session.startedAt).getTime() < FOCUS_MIN_MS) {
    await api.discardFocus(session.id);
    return false;
  }
  await api.finishFocus(session.id);
  return true;
}
