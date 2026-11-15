import { useEffect, useRef } from "react";
import { useUi } from "../../lib/store";
import { RELEASES, compareVersions, unseenReleases, type Release } from "../../lib/whatsNew";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function ReleaseItems({ release }: { release: Release }) {
  return (
    <ul className="news-items">
      {release.items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

/**
 * Once after an update, at the top of Today: what the new version brings. It stays until
 * "Got it", so it is never gone before it was read.
 */
export function WhatsNewCard() {
  const seen = useUi((s) => s.prefs.lastSeenVersion);
  const news = unseenReleases(seen, __APP_VERSION__);
  if (news.length === 0) return null;
  const shown = news.slice(0, 2);
  const done = () => useUi.getState().setPrefs({ lastSeenVersion: __APP_VERSION__ });
  return (
    <section className="block whats-new" aria-labelledby="whats-new-title">
      <div className="block-head">
        <h2 id="whats-new-title">New in Milo {__APP_VERSION__}</h2>
      </div>
      {shown.map((r, i) => (
        <div key={r.version}>
          {i > 0 && <h3 className="news-version">And in {r.version}</h3>}
          <ReleaseItems release={r} />
        </div>
      ))}
      <div className="news-foot">
        <button className="btn small" onClick={done}>Got it</button>
        {news.length > shown.length && (
          <button className="link" onClick={() => useUi.setState({ whatsNewOpen: true })}>
            See all changes
          </button>
        )}
      </div>
    </section>
  );
}

/** Every version and what it changed, from Settings. */
export function WhatsNewDialog() {
  const open = useUi((s) => s.whatsNewOpen);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    ref.current.showModal();
    ref.current.focus();
    ref.current.scrollTop = 0;
  }, [open]);
  if (!open) return null;
  const close = () => {
    useUi.setState({ whatsNewOpen: false });
    // Reading the full list counts as reading the card too.
    useUi.getState().setPrefs({ lastSeenVersion: __APP_VERSION__ });
  };
  return (
    <dialog ref={ref} className="dialog wide" tabIndex={-1} onClose={close} aria-labelledby="news-dialog-title">
      <h2 id="news-dialog-title">What's new in Milo</h2>
      <p className="muted">You have version {__APP_VERSION__}.</p>
      {RELEASES.filter((r) => compareVersions(r.version, __APP_VERSION__) <= 0).map((r) => (
        <section key={r.version} className="news-release">
          <h3 className="news-version">
            {r.version} <span className="muted">· {fmtDate(r.date)}</span>
          </h3>
          <ReleaseItems release={r} />
        </section>
      ))}
      <div className="dialog-foot">
        <span className="spacer" />
        <button className="btn primary" onClick={() => ref.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
