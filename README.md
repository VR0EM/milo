# Milo

A calm, local-only personal cockpit: calendar, tasks, focus and insights in one place.
Tauri + React + TypeScript, all data in one SQLite file on this machine.

    npm install
    npm run tauri dev      # run the app
    npm run dev            # UI only, in a browser, on in-memory data
    cd src-tauri && cargo test

Design and data decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).

Data lives in one SQLite file with daily backups next to it:
macOS `~/Library/Application Support/app.milo.desktop`, Windows `%APPDATA%\app.milo.desktop`.

Press `?` in the app for keyboard shortcuts.
