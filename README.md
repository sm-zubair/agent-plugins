# agent-plugins

A collection of [OpenCode](https://opencode.ai) **V2** plugins, one per top-level
directory.

## Plugins

| Plugin | Description |
| --- | --- |
| [`talk-back`](talk-back/README.md) | Windows-only text-to-speech: reads assistant responses aloud through the built-in WinRT/SAPI5 voices. Fully offline. |

## Layout

Each plugin is a self-contained directory. OpenCode loads it by convention:

| File | Role |
| --- | --- |
| `tui.ts` | CLI / TUI entrypoint (commands, keybinds, UI) |
| `index.ts` | server entrypoint |

There is no per-plugin `package.json` and nothing to register — a plugin *is* a
directory with those entrypoints.

```
agent-plugins/
├── AGENTS.md          # notes for coding agents working in this repo
├── package.json       # shared tooling (oxfmt, pnpm pin)
└── talk-back/         # one plugin
    ├── index.ts
    ├── tui.ts
    ├── backend.ts
    ├── normalize.ts
    ├── speak.ps1
    └── README.md
```

## Installing a plugin

Plugins are listed in OpenCode's global `cli.json`, not dropped into the
auto-discovered `~/.config/opencode/plugins/` directory. See the plugin's own
README for the exact snippet, e.g.
[`talk-back` → Promoting to global](talk-back/README.md#promoting-to-global).

## Development

There are no build, lint, test, or typecheck scripts: the CLI loads the `.ts`
sources directly. Tooling is limited to:

- **pnpm** (pinned to `12.11.2` via `packageManager` / `devEngines`) — use `pnpm`, not npm/yarn.
- **oxfmt** for formatting: `pnpm exec oxfmt <path>` rewrites files in place, `--check` verifies without writing.

See [`AGENTS.md`](AGENTS.md) for the repository-specific gotchas (dependency
mismatch, plugin loading rules, and per-plugin design constraints).
