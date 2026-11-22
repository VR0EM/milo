---
name: feature
description: Build a new feature or change how something in Milo looks or works, from a short idea or a screenshot to a tested, documented change. Use for any request to add, change, move, redesign or improve something in Milo, even when it is phrased vaguely ("can the calendar show week numbers", "make Today calmer").
argument-hint: what you want, in your own words (screenshots welcome)
---

# Build a feature in Milo

The request: $ARGUMENTS

Follow these steps in order. Do not skip one because the request looks small. Speak to her in
the language she wrote in.

## 1. Understand

- Restate the request in one or two sentences as something she will see or be able to do.
- If she sent screenshots, describe what you see in them and what should change.
- Find the code involved (`CLAUDE.md` map, `docs/ARCHITECTURE.md`) and read it.
- Search `docs/DECISIONS.md` for the area (calendar, Today, notices, ...). If an earlier
  decision went the other way, tell her what it was and why, and ask whether to change it.
- Read `docs/PRINCIPLES.md` if anything she sees will change.

## 2. Settle open questions

Only ask what changes the result and cannot be decided from the code, the docs or a sensible
default. At most three questions, each with your recommendation first and short options.
If nothing is open, say which defaults you chose and go on.

## 3. Plan

Write a short plan: what she will notice, which files change, how you will check it. Note
any risk (data, Windows, performance). Wait for her yes when the plan touches the database,
more than three files, or the look of a screen; otherwise continue.

## 4. Build

- Follow the matching recipe in `docs/ARCHITECTURE.md` (new field, command, setting, screen,
  MCP tool) step by step.
- Match the style of the surrounding code; use the existing tokens, components and helpers.
- Keep the change to what was asked.

## 5. Prove it

- Add or update tests for new logic (Vitest next to the code, Rust tests in the module).
- Run `npm run check` and fix everything it reports.
- For anything visible: open the browser preview (`milo-ui` in `.claude/launch.json`, URL
  `http://localhost:1420/?demo`), look at it in light and dark mode, try it like she would,
  and take a screenshot. Check a small window (1000 x 600) if layout changed.
- If the change depends on the real app (Rust, files, notifications, the tray), say that
  she should try it in `npm run tauri dev`, and what to look for.

## 6. Record it

- `src/lib/whatsNew.ts`: add a line under the next version (create the entry at the top
  if it does not exist, with today's date) in her words: what she will notice.
- `docs/DECISIONS.md`: a short section at the end, `## <Title> (<version>)`, with what
  changed and why, and anything the next developer must know.
- `README.md`: only if a feature in its list changed.

## 7. Report

In a few short paragraphs: what changed, how you checked it (with the screenshot), what you
could not check, and whether she wants to commit. Do not commit unless she asks.
