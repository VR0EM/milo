import { api } from "./api";
import { useUi } from "./store";
import type { FocusInput } from "./types";

/** Starts a focus session (and the small timer, if that is on). Used by every Start button. */
export async function beginFocus(input: FocusInput) {
  useUi.getState().setLastSpace(input.spaceId);
  const session = await api.startFocus(input);
  if (useUi.getState().prefs.focusMini) api.showFocusMini().catch(() => {});
  return session;
}
