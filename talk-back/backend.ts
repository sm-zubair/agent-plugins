import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

export type Voice = { name: string; id: string }

function toVoices(raw: any): Voice[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.filter((voice: any) => voice && typeof voice.name === "string").map((voice: any) => ({
    name: String(voice.name),
    id: voice.id === undefined || voice.id === null ? "" : String(voice.id),
  }))
}

/**
 * Owns the long-lived PowerShell speech worker.
 *
 * The worker synthesizes with WinRT or SAPI5 and plays back sequentially. There
 * is no cross-thread cancel: `stop()` kills the process, and the next `speak()`
 * starts a fresh one. That keeps the whole design single-threaded.
 *
 * The worker announces its voices once at startup, so a voice picker never has
 * to interrupt playback, and every worker gets a generation token so a dying
 * worker can never disturb the state of the one that replaced it.
 */
export class Speaker {
  private child: ChildProcessWithoutNullStreams | null = null
  private token = 0
  private buffer = ""
  private nextID = 0
  private voiceList: Voice[] = []
  private readyWaiters: Array<(voices: Voice[]) => void> = []
  private readonly script: string
  private readonly log: (message: string, data?: Record<string, unknown>) => void

  constructor(script: string, log: (message: string, data?: Record<string, unknown>) => void) {
    this.script = script
    this.log = log
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-NoLogo", "-ExecutionPolicy", "Bypass", "-File", this.script],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    )
    const token = ++this.token

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.consume(token, chunk))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      const text = chunk.trim()
      if (text.length > 0) this.log("stderr", { text })
    })
    // A write to a worker that just died must not take the TUI down with it.
    child.stdin.on("error", (error) => this.log("stdin error", { error: String(error) }))
    child.stdin.setDefaultEncoding("utf8")
    child.on("error", (error) => this.log("worker error", { error: String(error) }))
    child.on("exit", (code) => {
      if (this.child === child) {
        this.child = null
        this.buffer = ""
      }
      this.log("worker exited", { code })
    })

    this.child = child
    return child
  }

  private consume(token: number, chunk: string) {
    if (token !== this.token) return
    this.buffer += chunk
    let index = this.buffer.indexOf("\n")
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf("\n")
      if (line.length === 0) continue

      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        this.log("unparseable line", { line })
        continue
      }

      if (message.ev === "ready") {
        const voices = toVoices(message.voices)
        if (voices.length > 0) this.voiceList = voices
        const waiters = this.readyWaiters
        this.readyWaiters = []
        for (const waiter of waiters) waiter(voices)
        continue
      }

      if (message.ev === "error") this.log("worker reported error", { message: message.message })
    }
  }

  private write(payload: Record<string, unknown>) {
    this.ensure().stdin.write(JSON.stringify(payload) + "\n")
  }

  /** Speaks `text`. Never blocks; playback happens inside the worker. */
  speak(text: string, options: { voice?: string; rate?: number }) {
    this.write({ id: String(++this.nextID), cmd: "speak", text, voice: options.voice, rate: options.rate })
  }

  /** The installed voices, from the worker's startup announcement. */
  voices(timeout = 10000): Promise<Voice[]> {
    if (this.voiceList.length > 0) return Promise.resolve(this.voiceList)
    try {
      this.ensure()
    } catch (error) {
      return Promise.reject(error as Error)
    }
    if (this.voiceList.length > 0) return Promise.resolve(this.voiceList)
    return new Promise<Voice[]>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const waiter = (voices: Voice[]) => {
        clearTimeout(timer)
        resolve(voices)
      }
      timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((item) => item !== waiter)
        if (this.voiceList.length > 0) resolve(this.voiceList)
        else reject(new Error("timed out waiting for the speech worker"))
      }, timeout)
      this.readyWaiters.push(waiter)
    })
  }

  /** Stops playback by killing the worker; the next speak respawns it. */
  stop() {
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.kill()
    } catch (error) {
      this.log("failed to kill worker", { error: String(error) })
    }
  }

  dispose() {
    const child = this.child
    this.child = null
    this.readyWaiters = []
    if (!child) return
    try {
      child.stdin.write(JSON.stringify({ cmd: "shutdown" }) + "\n")
    } catch {
      // The worker may already be gone.
    }
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        // Already dead.
      }
    }, 750)
  }
}
