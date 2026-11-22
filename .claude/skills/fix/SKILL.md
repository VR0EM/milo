---
name: fix
description: Find and fix a bug in Milo from a description, an error message or a screenshot, by finding the real cause, proving it with a test and checking the fix. Use whenever something in Milo is wrong, broken, odd, slow, missing data, or "does not work", on Windows or macOS.
argument-hint: what goes wrong, where, and (if you can) a screenshot
---

# Fix a bug in Milo

The problem: $ARGUMENTS

Find the cause before you change anything. A fix that only hides the symptom is not done.
Speak to her in the language she wrote in.

## 1. Pin it down

- Restate the bug: what she did, what she expected, what happened.
- If something essential is missing (which screen, which platform, what she clicked), ask
  once, in one short message. Screenshots: describe exactly what is wrong in them.
- Check `docs/DECISIONS.md` for the area: sometimes it is intended behaviour, or an earlier
  fix explains the cause.

## 2. Find the cause

- Read the code path from the screen to the data (`docs/ARCHITECTURE.md`).
- Reproduce it where you can:
  - logic: a failing test (Vitest or a Rust test on an in-memory database);
  - screens: the browser preview at `http://localhost:1420/?demo`;
  - her data: you may read her database **read-only** to understand a data problem
    (macOS `~/Library/Application Support/app.milo.desktop/milo.sqlite`,
    Windows `%APPDATA%\app.milo.desktop\milo.sqlite`), for example with
    `sqlite3 -readonly`. To try a fix on real data, work on a copy in a temporary folder.
    Never write to her database directly and never commit anything from it.
- Explain the cause in one or two plain sentences before fixing it.

## 3. Fix

- Fix the cause, in the right layer (data problems in Rust, display problems in React).
- If existing data is wrong because of the bug, add a migration that repairs it (new
  numbered file; the app backs up the database before migrating).
- Keep the fix small; mention other problems you noticed instead of fixing them unasked.

## 4. Prove it

- The test that failed now passes; add one if there was none.
- `npm run check` passes.
- Visible bugs: check the preview in light and dark mode, with a screenshot.
- Windows-only bugs: you cannot run Windows. Say so, explain why the fix should work there,
  and tell her what to try after the release.

## 5. Record and report

- `src/lib/whatsNew.ts`: one line in her words if she would notice the fix.
- `docs/DECISIONS.md`: what went wrong and why, if it teaches something about the code.
- Report: the cause, the fix, how you checked it, what is left to check. Do not commit
  unless she asks.
