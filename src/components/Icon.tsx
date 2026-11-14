// One small icon set, drawn on a 16px grid with a 1.5px stroke, so every icon matches.

const PATHS = {
  today: <><circle cx="8" cy="8" r="5.75" /><circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" /></>,
  calendar: <><rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" /><path d="M2.25 6.75h11.5M5.5 1.75v3M10.5 1.75v3" /></>,
  tasks: <><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" /><path d="M5.25 8.1l1.9 1.9 3.6-3.85" /></>,
  insights: <path d="M3.5 13.25v-4.5M8 13.25v-9.5M12.5 13.25v-6.5" />,
  reminders: <><path d="M4 11.25V7.5a4 4 0 0 1 8 0v3.75l1 1.25H3z" /><path d="M6.5 14.25h3" /></>,
  import: <><path d="M8 2.25v7.5M5 7l3 3 3-3" /><path d="M2.75 11v1.5a1.25 1.25 0 0 0 1.25 1.25h8a1.25 1.25 0 0 0 1.25-1.25V11" /></>,
  archive: <><rect x="2" y="2.75" width="12" height="3.25" rx="1" /><path d="M3 6v6.75A1.25 1.25 0 0 0 4.25 14h7.5A1.25 1.25 0 0 0 13 12.75V6M6.5 9h3" /></>,
  settings: <><path d="M2.5 5h4.25M9.75 5h3.75M2.5 11h1.75M7.25 11h6.25" /><circle cx="8.25" cy="5" r="1.5" /><circle cx="5.75" cy="11" r="1.5" /></>,
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  chevron: <path d="M6 4l4 4-4 4" />,
  left: <path d="M10 4L6 8l4 4" />,
  right: <path d="M6 4l4 4-4 4" />,
  focus: <><circle cx="8" cy="8.75" r="5" /><path d="M8 6.25v2.5l1.75 1M6.5 1.75h3" /></>,
  search: <><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.5 3.5" /></>,

  // For spaces: one of these can stand for a space, in its colour.
  book: <><path d="M8 4.25C6.6 3.2 4.6 2.9 2.5 3.25v9c2.1-.35 4.1-.05 5.5 1 1.4-1.05 3.4-1.35 5.5-1v-9c-2.1-.35-4.1-.05-5.5 1z" /><path d="M8 4.25v9" /></>,
  flask: <><path d="M6.25 2.25h3.5M6.75 2.25v4L3.4 12.1a1.1 1.1 0 0 0 .95 1.65h7.3a1.1 1.1 0 0 0 .95-1.65L9.25 6.25v-4" /><path d="M4.9 9.75h6.2" /></>,
  sigma: <path d="M12 3.25H4.25L8.5 8l-4.25 4.75H12" />,
  code: <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />,
  globe: <><circle cx="8" cy="8" r="5.75" /><path d="M2.25 8h11.5M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75C6.4 12.15 5.6 10.25 5.6 8S6.4 3.85 8 2.25z" /></>,
  pen: <><path d="M10.25 2.75l3 3L6 13H3v-3z" /><path d="M8.75 4.25l3 3" /></>,
  palette: <><path d="M8 2.25a5.75 5.75 0 1 0 0 11.5c.9 0 1.25-.6 1.25-1.25 0-.9-.75-1.15-.75-2 0-.7.55-1.25 1.25-1.25h1.5a2.5 2.5 0 0 0 2.5-2.5C13.75 4.4 11.2 2.25 8 2.25z" /><circle cx="5.25" cy="7.5" r=".7" fill="currentColor" stroke="none" /><circle cx="7.6" cy="5" r=".7" fill="currentColor" stroke="none" /><circle cx="10.5" cy="5.9" r=".7" fill="currentColor" stroke="none" /></>,
  music: <><path d="M6 12V3.75l7-1.5v8.25" /><circle cx="4.25" cy="12" r="1.75" /><circle cx="11.25" cy="10.5" r="1.75" /></>,
  briefcase: <><rect x="2.25" y="4.75" width="11.5" height="8.5" rx="1.75" /><path d="M5.75 4.75v-1a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1M2.25 8.5h11.5" /></>,
  home: <path d="M2.75 7.25L8 2.75l5.25 4.5V13a.75.75 0 0 1-.75.75h-3v-3.5h-3v3.5h-3a.75.75 0 0 1-.75-.75z" />,
  heart: <path d="M8 13.25S2.25 9.9 2.25 6.1A2.85 2.85 0 0 1 8 4.75a2.85 2.85 0 0 1 5.75 1.35c0 3.8-5.75 7.15-5.75 7.15z" />,
  dumbbell: <path d="M4.5 5v6M11.5 5v6M2.5 6.5v3M13.5 6.5v3M4.5 8h7" />,
  bus: <><rect x="3.25" y="2.25" width="9.5" height="9.5" rx="2" /><path d="M3.25 7.25h9.5M5.5 11.75v2M10.5 11.75v2" /><circle cx="5.75" cy="9.5" r=".6" fill="currentColor" stroke="none" /><circle cx="10.25" cy="9.5" r=".6" fill="currentColor" stroke="none" /></>,
  moon: <path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85z" />,
  leaf: <><path d="M3 13c0-6 3.5-9.75 10-10.25C12.75 9.5 9 13 3 13z" /><path d="M3 13l5.5-5.5" /></>,
  chat: <path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5v-2.5h-.25a1 1 0 0 1-1-1z" />,
  cup: <path d="M3 5.75h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 6.75h1a1.75 1.75 0 0 1 0 3.5h-1M5.5 2.25v1.5M8.25 2.25v1.5" />,
  star: <path d="M8 2.25l1.75 3.6 3.95.55-2.85 2.8.7 3.9L8 11.25 4.45 13.1l.7-3.9L2.3 6.4l3.95-.55z" />,
} as const;

/** The icons a space can have, in the order the picker shows them. */
export const SPACE_ICONS = [
  "book", "flask", "sigma", "code", "globe", "pen", "palette", "music", "briefcase",
  "home", "heart", "dumbbell", "bus", "moon", "leaf", "chat", "cup", "star",
] as const;
export type SpaceIcon = (typeof SPACE_ICONS)[number];
const isIcon = (v: string | null | undefined): v is IconName => !!v && v in PATHS;

export type IconName = keyof typeof PATHS;

/** A space's mark: its icon in its colour, or the plain colour square. Set --c on a parent. */
export function SpaceMark({ icon, size = 14, filled = true }: { icon: string | null | undefined; size?: number; filled?: boolean }) {
  return isIcon(icon) ? (
    <span className="space-mark" style={{ width: size, height: size }}>
      <Icon name={icon} size={size} />
    </span>
  ) : (
    <span className={filled ? "swatch big-sq" : "swatch"} />
  );
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
