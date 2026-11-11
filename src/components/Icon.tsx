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
} as const;

export type IconName = keyof typeof PATHS;

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
