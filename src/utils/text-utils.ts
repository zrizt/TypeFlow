const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("id", { granularity: "grapheme" })
    : null;

const wordSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("id", { granularity: "word" })
    : null;

const FALLBACK_WORD_PATTERN =
  /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    const parts: string[] = [];
    for (const segment of graphemeSegmenter.segment(text)) {
      parts.push(segment.segment);
    }
    return parts;
  }
  return Array.from(text);
}

export function countGraphemes(text: string): number {
  if (!text) return 0;
  if (graphemeSegmenter) {
    let count = 0;
    for (const _ of graphemeSegmenter.segment(text)) {
      count += 1;
    }
    return count;
  }
  return Array.from(text).length;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (wordSegmenter) {
    let count = 0;
    for (const segment of wordSegmenter.segment(trimmed)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }
  return trimmed.match(FALLBACK_WORD_PATTERN)?.length ?? 0;
}

export function countNewlines(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === "\n") count += 1;
  }
  return count;
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "--";
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, "0")}m`;
}

export function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  const chars = splitGraphemes(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

export function previewText(text: string, maxLength = 90): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "(empty)";
  return truncate(collapsed, maxLength);
}

export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
