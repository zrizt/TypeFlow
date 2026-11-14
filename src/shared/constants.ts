import type { EngineProgress, TypeFlowSettings } from "./types";

export const SPEED_PRESETS = {
  slow: 140,
  normal: 55,
  fast: 12,
} as const;

export const DEFAULT_SETTINGS: TypeFlowSettings = {
  method: "typing",
  theme: "system",
  typing: {
    speed: "normal",
    customMinDelay: 25,
    customMaxDelay: 60,
    paragraphPause: 500,
    startDelay: 3,
  },
};

export const LIMITS = {
  customMinDelay: { min: 1, max: 5000 },
  customMaxDelay: { min: 1, max: 5000 },
  paragraphPause: { min: 0, max: 10000 },
  startDelay: { min: 0, max: 30 },
  historyTextLength: 20000,
  maxTextLength: 250000,
} as const;

export const HISTORY_LIMIT = 25;

export const STORAGE_KEYS = {
  draft: "typeflow.draft",
  settings: "typeflow.settings",
  history: "typeflow.history",
  installedVersion: "typeflow.installedVersion",
} as const;

export const IDLE_PROGRESS: EngineProgress = {
  status: "idle",
  charsCompleted: 0,
  totalChars: 0,
  percent: 0,
  remainingMs: null,
  startedAt: null,
  message: "",
  targetLabel: "",
  pausedPhase: null,
};

export const ACTIVE_STATUSES = new Set(["countdown", "typing", "paused"]);

export const CONTENT_SCRIPT_FILE = "content/content.js";
export const BRIDGE_SCRIPT_FILE = "content/bridge.js";
export const PASTE_REQUEST_EVENT = "typeflow:paste";

export const MESSAGE_TYPES = {
  start: "TYPEFLOW_START",
  pause: "TYPEFLOW_PAUSE",
  resume: "TYPEFLOW_RESUME",
  stop: "TYPEFLOW_STOP",
  insert: "TYPEFLOW_INSERT",
  getState: "TYPEFLOW_GET_STATE",
  engineState: "TYPEFLOW_ENGINE_STATE",
} as const;
