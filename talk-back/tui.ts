import { Plugin } from "@opencode/plugin/tui"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Speaker, type Voice } from "./backend"
import { normalizeForSpeech } from "./normalize"

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "speak.ps1")

const DEFAULTS = {
  voice: "Microsoft Mark",
  rate: 0,
  auto: true,
}

type Settings = {
  voice: string
  rate: number
  auto: boolean
}

/** The last assistant message's text parts, or undefined when there is none. */
function lastAssistantText(messages: readonly any[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.type !== "assistant") continue
    const content = Array.isArray(message.content) ? message.content : []
    const text = content
      .filter((part: any) => part && part.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text as string)
      .join("\n\n")
      .trim()
    return text.length > 0 ? text : undefined
  }
  return undefined
}

export default Plugin.define({
  id: "foodeals.talk-back",
  setup(context) {
    const options: Record<string, any> = context.options ?? {}
    const [settings, update] = context.storage.store<Settings>("settings", {
      initial: {
        voice: typeof options.voice === "string" ? options.voice : DEFAULTS.voice,
        rate: typeof options.rate === "number" ? options.rate : DEFAULTS.rate,
        auto: typeof options.auto === "boolean" ? options.auto : DEFAULTS.auto,
      },
    })

    const speaker = new Speaker(script, (message, data) => {
      console.debug(`[talk-back] ${message}`, data ?? {})
    })

    const say = (text: string) => {
      const spoken = normalizeForSpeech(text)
      // Nothing speakable left (punctuation only, or all code).
      if (!/[\p{L}\p{N}]/u.test(spoken)) return
      try {
        speaker.speak(spoken, { voice: settings.voice, rate: settings.rate })
      } catch (error) {
        console.debug("[talk-back] could not speak", { error: String(error) })
        context.ui.toast.show({ message: `Talk-back failed: ${String(error)}`, variant: "error" })
      }
    }

    const currentSessionID = (): string | undefined => {
      const route: any = context.ui.router.current()
      return route && route.type === "session" ? route.sessionID : undefined
    }

    const readLast = async (sessionID: string | undefined): Promise<string | undefined> => {
      if (!sessionID) return undefined
      await context.data.session.message.sync(sessionID)
      return lastAssistantText(context.data.session.message.list(sessionID))
    }

    // Auto-speak: only for top-level sessions, so subagent chatter stays silent.
    const disposeEvent = context.data.on("session.execution.succeeded", (event: any) => {
      if (!settings.auto) return
      const sessionID = event?.data?.sessionID
      if (typeof sessionID !== "string") return
      if (context.data.session.root(sessionID) !== sessionID) return
      void (async () => {
        try {
          const text = await readLast(sessionID)
          if (text) say(text)
        } catch (error) {
          console.debug("[talk-back] auto speak failed", { error: String(error) })
        }
      })()
    })

    // The layer is removed automatically when this plugin deactivates.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "foodeals.talk-back.speak",
          title: "Talk-back: read the last response",
          group: "Talk-back",
          palette: true,
          slash: { name: "talk-back-speak" },
          run: async () => {
            const text = await readLast(currentSessionID())
            if (!text) {
              context.ui.toast.show({ message: "Nothing to read", variant: "warning" })
              return
            }
            say(text)
            context.ui.toast.show({ message: `Speaking as ${settings.voice}`, variant: "info" })
          },
        },
        {
          id: "foodeals.talk-back.mode",
          title: "Talk-back: toggle auto-speak",
          group: "Talk-back",
          palette: true,
          slash: { name: "talk-back-mode" },
          run: async () => {
            const next = !settings.auto
            await update((draft) => {
              draft.auto = next
            })
            context.ui.toast.show({ message: `Auto-speak ${next ? "on" : "off"}`, variant: "info" })
          },
        },
        {
          id: "foodeals.talk-back.stop",
          title: "Talk-back: stop speaking",
          group: "Talk-back",
          palette: true,
          slash: { name: "talk-back-stop" },
          run: () => {
            speaker.stop()
            context.ui.toast.show({ message: "Stopped speaking", variant: "info" })
          },
        },
        {
          id: "foodeals.talk-back.voice",
          title: "Talk-back: choose a voice",
          group: "Talk-back",
          palette: true,
          slash: { name: "talk-back-voice" },
          run: async () => {
            let voices: Voice[] = []
            try {
              voices = await speaker.voices()
            } catch (error) {
              console.debug("[talk-back] could not list voices", { error: String(error) })
            }
            if (voices.length === 0) {
              context.ui.toast.show({ message: "No voices available", variant: "error" })
              return
            }
            const chosen = await context.ui.dialog.select<string>({
              title: "Talk-back voice",
              current: settings.voice,
              options: voices.map((voice) => ({ title: voice.name, value: voice.name })),
            })
            if (typeof chosen !== "string") return
            await update((draft) => {
              draft.voice = chosen
            })
            context.ui.toast.show({ message: `Voice set to ${chosen}`, variant: "success" })
          },
        },
      ],
    }))

    context.ui.toast.show({
      message: `Talk-back ready · ${settings.voice} · auto ${settings.auto ? "on" : "off"}`,
      variant: "info",
    })

    return () => {
      disposeEvent()
      speaker.dispose()
    }
  },
})
