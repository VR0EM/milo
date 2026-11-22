# Milo's principles

What Milo should feel like, and the rules that follow from it. Read this before changing
anything she will see. When a request seems to break one of these, raise it; she may still
choose to, and then the principle changes here, with the reason in `DECISIONS.md`.

## The idea

Milo is a planner for a student who needs software to be **calm, predictable and clear**.
Most planners compete for attention; Milo shows what matters now, keeps the rest one click
away, and never surprises.

1. **Calm, not dull.** Clear colour fills, drawn icons and a clear type hierarchy (in the
   manner of Notion Calendar), but no noise: no sounds, emoji, confetti, streaks, points,
   badges that nag, or motion that draws the eye. An early grey, "minimal" version felt
   lifeless; restraint is not the same as removing colour.
2. **Predictable.** Things stay where they are. Nothing moves, reorders or pops up by
   itself. Layout does not shift when data loads. The same action always does the same thing.
3. **What matters now first.** Today and What now? show one next step, not everything.
   Rarely used things (import, archive, lists) live in Settings, not in the sidebar.
4. **Little text on screen.** Labels are short. Explanations sit behind a "?" and only where
   a name alone can be misread or where knowing takes a worry away.
5. **Forgiving.** Everything can be undone (Ctrl/Cmd+Z, Undo in a notice) or restored from
   the archive. Nothing is deleted without asking in place.
6. **Hers.** Her words, her colours, her choices: themes, accent, font, size, spacing,
   corners, Glass, which screens and Today blocks show. Defaults are sensible; nothing is
   forced.
7. **Private.** Her data stays on her computer. Features that would need an account, a
   server or tracking are out of scope unless she decides otherwise.

## Rules for the interface

### Words
- English, plain, short, sentence case. No jargon, no exclamation marks, no "Oops".
- Her vocabulary: *space* (a course, list or part of life), *to-do*, *productive time*,
  *What now?*, *archive* (not delete).
- Error messages say what happened and what she can do, in one or two sentences.
- Release notes (`whatsNew.ts`) describe what she will notice, not how it was built.

### Notices
A notice (the line at the bottom) only for:
- an error (stays until dismissed);
- something that happened out of sight (a file saved, a calendar synced, a backup restored);
- a bigger change that can be undone (archiving, an import), with Undo.

No notice for a change she sees happen (dragging, ticking, moving). Those still go on the
undo list with `useUi.remember`, so Ctrl/Cmd+Z works.

### Help ("?")
Use `components/HelpTip.tsx` only where a name can be misread or where an explanation takes
a worry away (for example "nothing is sent"). Self-evident settings get none.

### Look
- Use the tokens in `styles.css` (`--text`, `--muted`, `--line`, `--surface`, `--raised`,
  `--accent`, `--accent-soft`, `--c` for a space colour) and the scale variables (`--r`
  corners, `--d` spacing, `--text-scale` text size). Never hard-code colours, radii or font
  sizes.
- Every change must look right in light and dark mode, in each colour theme (Neutral, Paper,
  Slate, Sage, Ink), with high contrast, with Glass, and at Small and Large text.
- Grey text must stay readable (aim for a contrast of at least 4.5:1 for normal text).
- One icon set (`components/Icon.tsx`, 16 px grid, 1.5 px stroke). No emoji.
- Motion: at most 150 ms colour or opacity changes; off with reduced motion.
- Nothing scrolls sideways, at any window size down to 1000 x 600.

### Behaviour
- Keyboard: every common action has a key, and single-key shortcuts ignore key repeat.
  New shortcuts go in the shortcuts overview (`features/shortcuts/`).
- The calendar behaves like Notion Calendar where in doubt (drag, resize, zoom, overlap).
- It is an app, not a web page: no browser context menu, reload or back navigation.
- Buttons keep the hand cursor (she prefers it).

## Before you add something

Ask, in this order:
1. Does it help her plan or do her week with less effort or worry?
2. Can it be a better version of something that exists instead of something new?
3. Where does it live so that it is there when needed and invisible otherwise?
4. Does it keep Milo calm, predictable, private and forgiving?

If the answer to 1 is unclear, ask her what problem it solves before building it.
