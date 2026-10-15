# AGENTS.md

Collection of OpenCode **V2** plugins: one plugin per top-level directory. `talk-back/` is currently the only one (a Windows-only text-to-speech plugin).

## Plugin wiring (easy to get wrong)

- OpenCode V2 loads a plugin directory by convention: `tui.ts` (CLI/TUI entrypoint) and `index.ts` (server entrypoint). There is **no per-plugin `package.json`** and nothing to register — adding a plugin means adding a directory with those entrypoints.
- The V2 authoring API is the npm package **`@opencode/plugin`** (CLI/TUI subpath `@opencode/plugin/tui`). OpenCode resolves these imports at runtime.
- Expect a dependency mismatch: `package.json` declares only the V1 package **`@opencode-ai/plugin@^1.19.0`** (unused by the code), while `@opencode/plugin` is neither installed in `node_modules` nor in `pnpm-lock.yaml`. The CLI resolves the imports anyway, but raw `node`/`tsc` and editor autocomplete fail — don't chase a "cannot find module" here, and consult runtime/docs instead of local types.
- Plugin `id`s are namespaced by author, e.g. `foodeals.talk-back` (the server side uses `foodeals.talk-back.server`).

## Commands

- There are **no** build, lint, test, or typecheck scripts (`package.json` `scripts` is empty) and no `tsconfig.json`. The CLI loads `.ts` sources directly; there is nothing to compile or run in-repo.
- Formatting is `oxfmt`: `pnpm exec oxfmt [path]` rewrites in place; `--check` or `--list-different` verify without writing. It is **not clean** today (`.oxfmtrc.json` sets `semi: true` but the sources omit semicolons, and it also flags `package.json`/`README.md`), so format only the files you touch or reconcile the config first.
- Package manager is pinned to `pnpm@12.11.2` (`packageManager` + `devEngines` in `package.json`); use `pnpm`, not npm/yarn.

## talk-back

- Windows-only. `backend.ts` spawns `powershell.exe` running `speak.ps1`, which synthesizes with the WinRT `SpeechSynthesizer` and, for voices WinRT cannot see, SAPI5 `System.Speech`. Fully offline: no network, no API key, no admin.
- `index.ts` is intentionally empty (the server side does nothing); all logic is in `tui.ts` (commands/auto-speak), `backend.ts` (worker lifecycle), and `normalize.ts` (markdown -> speakable text).
- `speak.ps1` is a long-lived JSON-lines worker over stdin/stdout. It emits `{"ev":"ready","voices":[...]}` once at startup — the plugin's only voice source, awaited with a 10s timeout in `backend.ts` — plus `started`/`done`/`stopped`/`error`; the Node side currently acts only on `ready` and `error`. There are no shared types or tests, so the JS and PowerShell sides must be changed together.
- Stop is process-kill: playback blocks the worker's only thread, so `Speaker.stop()` **kills the process** and the next `speak()` respawns it — there is no cross-thread cancel. Don't add a cancel path without reworking that design.
- `normalize.ts` prioritizes listenability over fidelity (drops code blocks, tables, URLs, file paths). Keep it that way.
- Commands, defaults, the voice/rate mapping, and how to promote the plugin to global `cli.json` live in `talk-back/README.md`.
