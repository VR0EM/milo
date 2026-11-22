---
name: check
description: Check that Milo is healthy before committing or releasing - types, front-end tests, Rust tests, and optionally the layout of every screen - and explain any failure in plain words with a proposed fix. Use when she asks whether everything still works, before a commit or release, or after a larger change.
argument-hint: (optional) "full" to also check the layout of every screen
---

# Check Milo

1. Run `npm run check` (TypeScript, Vitest, and `cargo test` in `src-tauri`). It takes about
   a minute the first time Rust compiles.
2. If she asked for "full", or the change was visual: start the browser preview
   (`milo-ui` in `.claude/launch.json`) and run `npm run check:layout`.
3. Run `git status` and list what is not committed yet.

Report in her language:
- **All good**: one line per check that passed.
- **Something failed**: for each failure, which check, what it means in plain words, the
  likely cause, and the fix you propose. Fix it only if she asks, or if it is clearly
  caused by the change you just made in this conversation.
- Uncommitted work: what it is, and whether it looks ready to commit.
