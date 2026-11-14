export type InsertionMethod = "direct" | "typing";

export type SpeedPreset = "slow" | "normal" | "fast" | "custom";

export type ThemePreference = "light" | "dark" | "system";

export interface TypingSettings {
  speed: SpeedPreset;
  customMinDelay: number;
  customMaxDelay: number;
  paragraphPause: number;
  startDelay: number;
}

export interface TypeFlowSettings {
  method: InsertionMethod;
  typing: TypingSettings;
  theme: ThemePreference;
}

export interface Draft {
  text: string;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  text: string;
  createdAt: number;
}

export type EngineStatus =
  | "idle"
  | "countdown"
  | "typing"
  | "paused"
  | "completed"
  | "stopped"
  | "error";

export type EnginePhase = "countdown" | "typing";

export interface EngineProgress {
  status: EngineStatus;
  charsCompleted: number;
  totalChars: number;
  percent: number;
  remainingMs: number | null;
  startedAt: number | null;
  message: string;
  targetLabel: string;
  pausedPhase: EnginePhase | null;
}

export type TargetKind = "textarea" | "input" | "contenteditable" | "none";

export interface FocusInfo {
  hasEditable: boolean;
  focused: boolean;
  isFallback: boolean;
  kind: TargetKind;
  label: string;
  frameUrl: string;
  engine: EngineProgress;
  crossOriginFrame?: string;
}

export interface FrameReport {
  frameId: number;
  info: FocusInfo;
}

export type ErrorCode =
  | "NO_TARGET"
  | "TARGET_GONE"
  | "BLOCKED"
  | "RESTRICTED_PAGE"
  | "BAD_STATE"
  | "EMPTY_TEXT"
  | "INTERNAL";

export interface CommandResponse {
  ok: boolean;
  code?: ErrorCode;
  error?: string;
  state?: EngineProgress;
  target?: FocusInfo;
  insertedChars?: number;
}

export interface FrameStateMessage {
  type: "TYPEFLOW_ENGINE_STATE";
  state: EngineProgress;
}

export type PopupToContentMessage =
  | { type: "TYPEFLOW_START"; text: string; settings: TypingSettings }
  | { type: "TYPEFLOW_PAUSE" }
  | { type: "TYPEFLOW_RESUME" }
  | { type: "TYPEFLOW_STOP" }
  | { type: "TYPEFLOW_INSERT"; text: string }
  | { type: "TYPEFLOW_GET_STATE" };

export interface ContentApi {
  getFocusInfo(): FocusInfo;
  getEngineState(): EngineProgress;
  start(text: string, settings: TypingSettings): CommandResponse;
  pause(): CommandResponse;
  resume(): CommandResponse;
  stop(): CommandResponse;
  insertDirect(text: string): CommandResponse;
}

export interface ContentApiGlobal {
  __typeflow?: ContentApi;
}
