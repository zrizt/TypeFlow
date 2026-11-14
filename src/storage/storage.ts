import { DEFAULT_SETTINGS, HISTORY_LIMIT, LIMITS, STORAGE_KEYS } from "../shared/constants";
import type {
  Draft,
  HistoryEntry,
  InsertionMethod,
  SpeedPreset,
  ThemePreference,
  TypeFlowSettings,
  TypingSettings,
} from "../shared/types";
import { clampInteger } from "../utils/timer";

const SPEEDS: ReadonlySet<string> = new Set<SpeedPreset>([
  "slow",
  "normal",
  "fast",
  "custom",
]);
const METHODS: ReadonlySet<string> = new Set<InsertionMethod>(["direct", "typing"]);
const THEMES: ReadonlySet<string> = new Set<ThemePreference>([
  "light",
  "dark",
  "system",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampInteger(value, min, max)
    : fallback;
}

export function sanitizeTypingSettings(raw: unknown): TypingSettings {
  const base = DEFAULT_SETTINGS.typing;
  if (!isRecord(raw)) return { ...base };

  const speed =
    typeof raw.speed === "string" && SPEEDS.has(raw.speed)
      ? (raw.speed as SpeedPreset)
      : base.speed;
  const minDelay = numberOr(
    raw.customMinDelay,
    base.customMinDelay,
    LIMITS.customMinDelay.min,
    LIMITS.customMinDelay.max,
  );
  const maxDelay = numberOr(
    raw.customMaxDelay,
    Math.max(minDelay, base.customMaxDelay),
    LIMITS.customMaxDelay.min,
    LIMITS.customMaxDelay.max,
  );

  return {
    speed,
    customMinDelay: minDelay,
    customMaxDelay: Math.max(minDelay, maxDelay),
    paragraphPause: numberOr(
      raw.paragraphPause,
      base.paragraphPause,
      LIMITS.paragraphPause.min,
      LIMITS.paragraphPause.max,
    ),
    startDelay: numberOr(
      raw.startDelay,
      base.startDelay,
      LIMITS.startDelay.min,
      LIMITS.startDelay.max,
    ),
  };
}

export function sanitizeSettings(raw: unknown): TypeFlowSettings {
  const base = DEFAULT_SETTINGS;
  if (!isRecord(raw)) return structuredClone(base);

  const method =
    typeof raw.method === "string" && METHODS.has(raw.method)
      ? (raw.method as InsertionMethod)
      : base.method;
  const theme =
    typeof raw.theme === "string" && THEMES.has(raw.theme)
      ? (raw.theme as ThemePreference)
      : base.theme;

  return {
    method,
    theme,
    typing: sanitizeTypingSettings(raw.typing),
  };
}

export function sanitizeDraft(raw: unknown): Draft | null {
  if (!isRecord(raw) || typeof raw.text !== "string" || raw.text.length === 0) {
    return null;
  }
  return {
    text: raw.text.slice(0, LIMITS.maxTextLength),
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
  };
}

export function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || typeof item.text !== "string" || !item.text.trim()) {
      continue;
    }
    const text = item.text.slice(0, LIMITS.historyTextLength);
    if (seen.has(text)) continue;
    seen.add(text);
    entries.push({
      id: typeof item.id === "string" ? item.id : `${entries.length}-${item.createdAt ?? 0}`,
      text,
      createdAt:
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
          ? item.createdAt
          : 0,
    });
    if (entries.length >= HISTORY_LIMIT) break;
  }
  return entries;
}

export async function loadSettings(): Promise<TypeFlowSettings> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
    return sanitizeSettings(stored[STORAGE_KEYS.settings]);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings: TypeFlowSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function loadDraft(): Promise<Draft | null> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.draft);
    return sanitizeDraft(stored[STORAGE_KEYS.draft]);
  } catch {
    return null;
  }
}

export async function saveDraft(text: string): Promise<void> {
  if (!text) {
    await chrome.storage.local.remove(STORAGE_KEYS.draft);
    return;
  }
  const draft: Draft = { text: text.slice(0, LIMITS.maxTextLength), updatedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.draft]: draft });
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.history);
    return sanitizeHistory(stored[STORAGE_KEYS.history]);
  } catch {
    return [];
  }
}

export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.history]: entries.slice(0, HISTORY_LIMIT),
  });
}

export function addHistoryEntry(
  entries: HistoryEntry[],
  text: string,
  id: string,
): HistoryEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return entries;
  const storedText = text.slice(0, LIMITS.historyTextLength);
  const deduped = entries.filter((entry) => entry.text !== storedText);
  return [
    { id, text: storedText, createdAt: Date.now() },
    ...deduped,
  ].slice(0, HISTORY_LIMIT);
}
