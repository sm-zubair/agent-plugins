/**
 * Turns assistant markdown into something that sounds reasonable when spoken.
 *
 * The goal is not fidelity, it is listenability: code blocks, paths and URLs are
 * dropped, structure is unwrapped, and whitespace is collapsed.
 */
export function normalizeForSpeech(input: string): string {
  let text = input.replace(/\r\n/g, "\n")

  // Fenced code blocks disappear entirely.
  text = text.replace(/```[\s\S]*?```/g, " (code) ")
  text = text.replace(/~~~[\s\S]*?~~~/g, " (code) ")

  // Tables: drop rows entirely.
  text = text.replace(/^\s*\|.*\|\s*$/gm, "")

  // Images disappear, links keep their label.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")

  // Inline code keeps its content but loses the backticks.
  text = text.replace(/`([^`]+)`/g, "$1")

  // URLs and file paths are unlistenable.
  text = text.replace(/https?:\/\/\S+/g, " link ")
  text = text.replace(/[A-Za-z]:\\[^\s]+/g, " path ")
  text = text.replace(/(^|[\s(["'])(\.{1,2}\/[\w./-]+)/g, "$1 path ")

  // Structure: headings, bullets, numbers, quotes.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "")
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, "")
  text = text.replace(/^\s{0,3}\d+[.)]\s+/gm, "")
  text = text.replace(/^\s{0,3}>\s?/gm, "")

  // Horizontal rules.
  text = text.replace(/^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm, ". ")

  // Emphasis markers.
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2")
  text = text.replace(/(\*|_)(.*?)\1/g, "$2")
  text = text.replace(/~~(.*?)~~/g, "$1")

  // Collapse whitespace into speakable separators. Paragraph breaks become
  // sentence breaks; single line breaks (list items, table rows already gone)
  // become short pauses.
  text = text.replace(/[ \t]+/g, " ")
  text = text.replace(/\n{2,}/g, ". ")
  text = text.replace(/\n/g, ", ")

  // Tidy the punctuation those substitutions can pile up.
  text = text.replace(/([,.;:!?])(\s*[,.;:!?])+/g, "$1")
  text = text.replace(/\s+([,.;:!?])/g, "$1")
  text = text.replace(/\s{2,}/g, " ")
  text = text.replace(/^[\s,.;:!?]+/, "")

  return text.trim()
}
