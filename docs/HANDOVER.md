# Taking over Milo

Welcome. This page is for the new owner: what to move once, how to set up a computer to work
on Milo, and how to work with Claude Code on it. After this page, `CLAUDE.md` does the rest:
Claude reads it at the start of every session.

## What there is

| File | What it is for |
| --- | --- |
| `CLAUDE.md` | How Claude works in this project. Loaded automatically. |
| `docs/PRINCIPLES.md` | What Milo should feel like, and the rules for anything you see. |
| `docs/ARCHITECTURE.md` | How the code is built, and recipes for common changes. |
| `docs/DECISIONS.md` | Every larger choice so far, and why. The project's memory. |
| `docs/RELEASING.md` | Publishing a version so installed copies update. |
| `.claude/skills/` | The slash commands below. |

## Once: move the project

### 1. The repository

Installed copies look for updates at
`https://github.com/VR0EM/milo/releases/latest/download/latest.json`. Two ways to take over:

- **Transfer the repository to your account** (recommended). The current owner: GitHub >
  the repository > Settings > General > Transfer ownership. GitHub keeps redirecting the old
  address, so installed copies still find updates. Then, in your first release, change the
  address in `src-tauri/tauri.conf.json` (`plugins.updater.endpoints`) to your account, so it
  no longer depends on the redirect. The old owner must not create a new repository named
  `milo` afterwards: that would end the redirect.
- **Stay a collaborator**: the current owner adds you with the Admin role. Nothing changes for
  updates. Simpler, but the project stays under the old account.

### 2. The signing key

Updates are signed with a private key that is **not** in the repository (see
`docs/RELEASING.md`). Without it, installed copies cannot be updated.

1. The current owner shares `~/.tauri/milo.key` with you privately, through a password
   manager or in person. Never through the repository, an issue, a chat or an email.
2. Save it as `%USERPROFILE%\.tauri\milo.key` (Windows) and keep a copy in your password
   manager.
3. Check that the repository has the secret `TAURI_SIGNING_PRIVATE_KEY` (Settings > Secrets
   and variables > Actions). After a transfer, set it again to be sure:

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/milo.key
   ```

## Once: set up a Windows computer

Install, in this order:

1. **Git** and the **GitHub CLI** (`winget install Git.Git GitHub.cli`), then `gh auth login`.
2. **Node.js 22 LTS** (`winget install OpenJS.NodeJS.LTS`).
3. **Visual Studio Build Tools** with the workload "Desktop development with C++"
   (needed by Rust on Windows).
4. **Rust** through rustup (`winget install Rustlang.Rustup`), default MSVC toolchain.
5. **Claude Code**.

Then:

```bash
git clone https://github.com/<owner>/milo.git
cd milo
npm ci
npm run check
npm run tauri dev
```

`npm run check` runs every test (the first time takes a few minutes while Rust compiles).
`npm run tauri dev` opens Milo with your changes.

## Your data while you develop

You use Milo every day **and** work on it on the same computer, so the two are kept apart:

- The **installed Milo** uses your real data in `%APPDATA%\app.milo.desktop`.
- A **development build** (`npm run tauri dev`) works on a **test copy** in
  `%APPDATA%\app.milo.desktop-dev`, made from your real data the first time it starts. Its
  window is called "Milo (test copy)". Nothing you try there touches your real data, and it
  never writes into your second backup folder.
- Want a fresh copy? Quit the development build and delete the `app.milo.desktop-dev` folder.
- Really need your real data in a development build? Start it with `MILO_REAL_DATA` set
  (PowerShell: `$env:MILO_REAL_DATA=1; npm run tauri dev`). Be careful.
- Both can run at once; you may then get reminders twice.

## Working with Claude Code

Open the `milo` folder in Claude Code (Opus). Claude reads `CLAUDE.md` and knows the project,
its rules and the way of working. You do not need to write long prompts: say what you want
or what is wrong, in Dutch or English, and add a screenshot when it is about something you see.

### The slash commands

| Type | When | Example |
| --- | --- | --- |
| `/feature` | Add or change something | `/feature week numbers in the month view` |
| `/fix` | Something is wrong | `/fix on Windows the focus timer stays white` + screenshot |
| `/explain` | Understand before you decide | `/explain how a calendar link sync works` |
| `/check` | Is everything still fine? | `/check full` |
| `/release` | Publish a version | `/release` |

Plain messages work too: Claude picks the right way of working by itself.

### Tips

- **One topic per session.** Start a new session for something unrelated; the previous one
  stays readable in the history.
- **Show, do not describe.** A screenshot with an arrow beats a paragraph.
- **Say what you expected.** "I expected X, it does Y" is the best bug report.
- **Let Claude ask.** If it asks a question, its first option is its recommendation; "yes"
  is a fine answer.
- **Commit when you are happy.** Claude never commits, pushes or releases unless you ask.
  "Commit" is enough; `/release` when you want it on your laptop.
- **Try it in the app.** Claude checks the screens in a browser preview, but Windows-only
  behaviour (the tray, notifications, the focus mini timer) needs `npm run tauri dev`.

## Open points at the handover

- **Second backup folder**: set one in Settings > Data (for example in OneDrive), so the data
  survives a broken laptop.
- **Glass and the new calendar layout** (0.4.5, 0.4.6) were tested in the browser and on
  macOS, not yet on Windows: worth a look.
- **A phone version** was considered and set aside: an iPhone app needs a paid Apple
  developer account, and the real work is syncing data between devices, which goes against
  "no account, no server". Revisit only if the need is clear after some weeks of use.
