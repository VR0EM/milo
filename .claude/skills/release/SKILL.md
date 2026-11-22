---
name: release
description: Prepare and publish a new version of Milo so installed copies update themselves - release notes, checks, version bump, tag and push - following docs/RELEASING.md. Use when she wants to release, publish, ship or "get it on my laptop".
argument-hint: (optional) the version number, e.g. 0.5.0
---

# Release a new version of Milo

Read `docs/RELEASING.md` first. Speak to her in her language.

1. **What goes out.** List the commits since the last tag
   (`git describe --tags --abbrev=0`, then `git log <tag>..HEAD --oneline`). If there are
   uncommitted changes, stop and ask whether to commit them first.
2. **Version number.** Propose the next one: the last number + 1 for fixes and small changes
   (0.4.6 to 0.4.7), the middle number + 1 for a larger new feature (0.4.6 to 0.5.0). Use
   hers if she gave one.
3. **Release notes.** Make sure the top entry of `src/lib/whatsNew.ts` has this version,
   today's date, and a line in her words for each change she will notice. Show her the
   notes. Commit them if they changed (`Release notes for <version>`).
4. **Checks.** Run `npm run check`. Do not release if anything fails.
5. **Confirm.** Ask her once: "Release <version> with these notes?" Wait for yes.
6. **Release.** Run `npm run release -- <version>` (bumps the version everywhere, commits,
   tags). Then `git push && git push origin v<version>`.
7. **Follow up.** The Release workflow builds Windows and macOS installers (10-15 minutes).
   Show her how to watch it (`gh run list --limit 3`). When it has a green tick, installed
   copies offer the update in Settings > Updates and at the next start.

If the workflow fails, read its log (`gh run view <id> --log-failed`), explain the cause
plainly, fix it, and release a new patch version (never move or reuse a tag).
