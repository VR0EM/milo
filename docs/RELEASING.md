# Releasing a new version

Installed copies of Milo ask GitHub for the newest version (Settings > Updates, and at most
once a day at start-up). They install it only when you click **Install and restart**; the
data stays where it is. With Claude, `/release` walks through all of this.

## Once: the signing key

Updates are signed, so Milo only accepts updates made by you.

- The **private key** is a file, `milo.key`, kept in `~/.tauri/` (Windows:
  `%USERPROFILE%\.tauri\milo.key`). Keep a backup of it in a password manager.
  **It never goes into the repository, a chat or an email.** If it is lost, installed copies
  can no longer accept updates and Milo has to be installed again by hand once, with a new key.
- The **public key** is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- GitHub needs the private key as a repository secret named `TAURI_SIGNING_PRIVATE_KEY`
  (Settings > Secrets and variables > Actions). Set it yourself, in a terminal:

  ```bash
  gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/milo.key
  ```

  The key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is not needed.

## Every time: a new version

1. Write what the version brings at the top of `src/lib/whatsNew.ts`, in plain words (English,
   like the app). Milo shows it once on Today after the update. The release script refuses a
   version without notes, and `npm test` fails too.
2. Commit everything, and run `npm run check`.
3. Pick a higher version number (fixes: 0.4.6 to 0.4.7; a bigger feature: 0.4.6 to 0.5.0):

   ```bash
   npm run release -- 0.4.7
   ```

   This sets the number in `package.json`, `tauri.conf.json` and `Cargo.toml`, commits it and
   creates the tag `v0.4.7`.
4. Push the commit and the tag:

   ```bash
   git push && git push origin v0.4.7
   ```

5. GitHub Actions (workflow **Release**) builds Milo for Windows and macOS and publishes it on
   the Releases page with `latest.json`. Follow it with `gh run list --limit 3`. After about
   ten to fifteen minutes installed copies see the update.

## If a release fails

Read the log (`gh run view <id> --log-failed`), fix the cause, and release the next patch
version. Never move, delete or reuse a tag that was pushed.
