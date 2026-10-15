# talk-back — speak OpenCode responses with the Windows system voice

Local OpenCode V2 plugin that reads assistant answers aloud through the Windows
speech engines (WinRT `SpeechSynthesizer` + SAPI5 `System.Speech`). Fully offline, no
API key, no network, no admin rights.

## Files

| File | Role |
| --- | --- |
| `index.ts` | server entrypoint — intentionally empty |
| `tui.ts` | TUI entrypoint — commands, auto-speak, settings |
| `backend.ts` | spawns and talks to the PowerShell worker |
| `normalize.ts` | markdown -> speakable plain text |
| `speak.ps1` | long-lived WinRT + SAPI5 synthesis and playback worker |

Entrypoints are resolved by the CLI itself (`tui.ts` for the terminal, `index.ts`
for the server), so there is no `package.json` and nothing to register.

## Usage

| Command | Effect |
| --- | --- |
| `/talk-back-speak` | read the current session's last response |
| `/talk-back-stop` | stop playback immediately |
| `/talk-back-mode` | toggle auto-speak (persisted) |
| `/talk-back-voice` | pick from every installed WinRT + SAPI5 voice |

Auto-speak is **on** by default and only fires for top-level sessions, so subagent
chatter stays silent. All four commands are also in the command palette.

## Defaults

Voice `Microsoft Mark`, rate `0`, auto-speak `true`.

Volume is deliberately left alone so loudness follows the system volume and the OS
mixer. WinRT `SpeechSynthesizer` has no integer rate, so WinRT voices use an SSML
prosody multiplier: `-10..10` maps to `1 + rate/10`, clamped to `0.5..2.0`. SAPI5
voices use their native integer `-10..10` rate directly.

Settings live in plugin storage (durable, survives restarts) and can be seeded
from `cli.json` options when the plugin moves to global config.

## How playback and stopping work

The worker synthesizes sentence-sized chunks and plays them one after another with
`SoundPlayer.PlaySync`, which blocks its only thread. Stopping therefore means
killing the process; the next `speak` lazily starts a fresh worker. No threads, no
cancellation races.

## Promoting to global

1. Move this directory to `C:\Users\sm_zu\.config\opencode\talk-back\`.
2. Add it to `C:\Users\sm_zu\.config\opencode\cli.json`:

```jsonc
{
  "plugins": [
    { "package": "C:\\Users\\sm_zu\\.config\\opencode\\talk-back", "options": { "voice": "Microsoft Mark", "rate": 0, "auto": true } }
  ]
}
```

Keep it **out of** `~/.config/opencode/plugins/`, which is auto-discovered — listing
it in `cli.json` as well would load it twice.

## Voices: which ones appear

The worker lists voices from two Windows engines and merges them (WinRT wins a
name clash):

- **WinRT** (`SpeechSynthesizer.AllVoices`) — the OneCore voices, e.g. Microsoft
  David / Mark / Zira.
- **SAPI5** (`System.Speech`) — classic "Desktop" voices, plus anything a
  third-party driver bridges into SAPI.

Extra languages come from Windows speech language packs: Settings -> Time & Language
-> Language & region -> add the language, then add its **Speech** feature. The
classic voices (e.g. en-GB George / Hazel) appear in `/talk-back-voice` automatically.

### Narrator "Natural" voices (Ryan, Sonia, ...) do not appear

The Store voices installed via Settings -> Accessibility -> Narrator -> "Add natural
voices" (e.g. *Microsoft Ryan (Natural)*) are **not** registered with either WinRT or
SAPI — they are private models only Narrator can drive, so no WinRT/SAPI app can list
or speak them directly. To reach them from this plugin, bridge them into a SAPI5
voice with a third-party driver such as `gexgd0419/NaturalVoiceSAPIAdapter`; the voice
then shows up in `/talk-back-voice` and is spoken through the SAPI path. Be aware that
the adapter warns its newest natural-voice packages no longer work with it.
