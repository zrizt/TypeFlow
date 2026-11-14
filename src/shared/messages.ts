import type {
  CommandResponse,
  EngineProgress,
  EngineStatus,
  FocusInfo,
  FrameStateMessage,
} from "./types";

const ENGINE_STATUSES: ReadonlySet<string> = new Set<EngineStatus>([
  "idle",
  "countdown",
  "typing",
  "paused",
  "completed",
  "stopped",
  "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isEngineProgress(value: unknown): value is EngineProgress {
  if (!isRecord(value)) return false;
  return (
    typeof value.status === "string" &&
    ENGINE_STATUSES.has(value.status) &&
    isFiniteNumber(value.charsCompleted) &&
    isFiniteNumber(value.totalChars) &&
    isFiniteNumber(value.percent) &&
    (value.remainingMs === null || isFiniteNumber(value.remainingMs)) &&
    (value.startedAt === null || isFiniteNumber(value.startedAt)) &&
    typeof value.message === "string" &&
    typeof value.targetLabel === "string" &&
    (value.pausedPhase === null ||
      value.pausedPhase === "countdown" ||
      value.pausedPhase === "typing")
  );
}

export function isFrameStateMessage(value: unknown): value is FrameStateMessage {
  return (
    isRecord(value) &&
    value.type === "TYPEFLOW_ENGINE_STATE" &&
    isEngineProgress(value.state)
  );
}

export function isFocusInfo(value: unknown): value is FocusInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.hasEditable === "boolean" &&
    typeof value.focused === "boolean" &&
    typeof value.isFallback === "boolean" &&
    typeof value.kind === "string" &&
    typeof value.label === "string" &&
    typeof value.frameUrl === "string" &&
    (value.crossOriginFrame === undefined || typeof value.crossOriginFrame === "string") &&
    isEngineProgress(value.engine)
  );
}

export function isCommandResponse(value: unknown): value is CommandResponse {
  if (!isRecord(value)) return false;
  return typeof value.ok === "boolean";
}

export function isPopupToContentMessage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "TYPEFLOW_START":
      return typeof value.text === "string" && isRecord(value.settings);
    case "TYPEFLOW_INSERT":
      return typeof value.text === "string";
    case "TYPEFLOW_PAUSE":
    case "TYPEFLOW_RESUME":
    case "TYPEFLOW_STOP":
    case "TYPEFLOW_GET_STATE":
      return true;
    default:
      return false;
  }
}
