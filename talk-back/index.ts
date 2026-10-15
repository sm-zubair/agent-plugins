import { Plugin } from "@opencode/plugin"

/**
 * Server-side entrypoint.
 *
 * All of the speech work happens in the CLI (TUI) runtime, next to the audio
 * device, so this side is intentionally empty. It exists so the plugin
 * directory has the documented `index.ts` + `tui.ts` shape.
 */
export default Plugin.define({
  id: "foodeals.talk-back.server",
  setup() { },
})
