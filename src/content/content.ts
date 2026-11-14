import { DEFAULT_SETTINGS, IDLE_PROGRESS } from "../shared/constants";
import { isPopupToContentMessage } from "../shared/messages";
import type {
  CommandResponse,
  ContentApi,
  ContentApiGlobal,
  EngineProgress,
  FocusInfo,
  FrameStateMessage,
  PopupToContentMessage,
  TypingSettings,
} from "../shared/types";
import { sanitizeTypingSettings } from "../storage/storage";
import { getDeepActiveElement } from "../utils/dom-utils";
import { countGraphemes, normalizeNewlines } from "../utils/text-utils";
import {
  FieldAdapter,
  InsertionError,
  closestEditable,
  describeTarget,
  findFallbackTarget,
  isEditableElement,
} from "./insertion";
import { TypingEngine, idleProgress } from "./typing-engine";

const NO_TARGET_MESSAGE =
  "No editable field found. Click inside the reply box, then reopen TypeFlow. If the editor is inside an embedded frame, reload the page and try again.";

let lastEditable: HTMLElement | null = null;
let lastRange: Range | null = null;
let engine: TypingEngine | null = null;

function isActive(status: EngineProgress["status"]): boolean {
  return status === "countdown" || status === "typing" || status === "paused";
}

function pickTarget(): {
  target: HTMLElement | null;
  focused: boolean;
  isFallback: boolean;
} {
  const active = getDeepActiveElement();
  const activeEditable = closestEditable(active);
  if (activeEditable) {
    return { target: activeEditable, focused: true, isFallback: false };
  }
  if (lastEditable && lastEditable.isConnected && isEditableElement(lastEditable)) {
    return { target: lastEditable, focused: false, isFallback: false };
  }
  const fallback = findFallbackTarget();
  return { target: fallback, focused: false, isFallback: fallback !== null };
}

function getEngineState(): EngineProgress {
  return engine?.snapshot() ?? idleProgress();
}

function detectCrossOriginFrame(): string | undefined {
  const active = getDeepActiveElement();
  if (!(active instanceof HTMLIFrameElement)) return undefined;
  try {
    const url = new URL(active.src, location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.origin === location.origin) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function getFocusInfo(): FocusInfo {
  const picked = pickTarget();
  const state = getEngineState();
  if (!picked.target) {
    return {
      hasEditable: false,
      focused: false,
      isFallback: false,
      kind: "none",
      label: "",
      frameUrl: location.href,
      engine: state,
      crossOriginFrame: detectCrossOriginFrame(),
    };
  }
  const described = describeTarget(picked.target);
  return {
    hasEditable: true,
    focused: picked.focused,
    isFallback: picked.isFallback,
    kind: described.kind,
    label: described.label,
    frameUrl: location.href,
    engine: state,
  };
}

function emitState(state: EngineProgress): void {
  const message: FrameStateMessage = { type: "TYPEFLOW_ENGINE_STATE", state };
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === "function") {
      result.catch(() => undefined);
    }
  } catch {
    /* The popup or service worker may not be listening. */
  }
}

function success(
  state: EngineProgress,
  extra: Partial<CommandResponse> = {},
): CommandResponse {
  return { ok: true, state, ...extra };
}

function failure(error: unknown): CommandResponse {
  if (error instanceof InsertionError) {
    return { ok: false, code: error.code, error: error.message };
  }
  return {
    ok: false,
    code: "INTERNAL",
    error: error instanceof Error ? error.message : "Unexpected extension error.",
  };
}

function startTyping(text: string, rawSettings: unknown): CommandResponse {
  if (engine?.isRunning()) {
    return {
      ok: false,
      code: "BAD_STATE",
      error: "A typing operation is already running in this tab.",
      state: getEngineState(),
    };
  }
  const normalized = normalizeNewlines(text);
  if (!normalized.trim()) {
    return { ok: false, code: "EMPTY_TEXT", error: "There is no text to type." };
  }

  const picked = pickTarget();
  if (!picked.target) {
    return {
      ok: false,
      code: "NO_TARGET",
      error: NO_TARGET_MESSAGE,
    };
  }
  lastEditable = picked.target;
  const described = describeTarget(picked.target);
  const settings: TypingSettings = sanitizeTypingSettings(rawSettings ?? DEFAULT_SETTINGS.typing);

  try {
    const adapter = new FieldAdapter(picked.target, lastRange, {
      appendAtEnd: picked.isFallback,
    });
    engine = new TypingEngine(settings, {
      targetLabel: described.label,
      onUpdate: emitState,
    });
    const state = engine.start(normalized, settings, adapter);
    return success(state, { target: getFocusInfo() });
  } catch (error) {
    return failure(error);
  }
}

function insertDirect(text: string): CommandResponse {
  if (engine?.isRunning()) {
    return {
      ok: false,
      code: "BAD_STATE",
      error: "Stop the current typing operation before inserting directly.",
      state: getEngineState(),
    };
  }
  const normalized = normalizeNewlines(text);
  if (!normalized.trim()) {
    return { ok: false, code: "EMPTY_TEXT", error: "There is no text to insert." };
  }
  const picked = pickTarget();
  if (!picked.target) {
    return {
      ok: false,
      code: "NO_TARGET",
      error: NO_TARGET_MESSAGE,
    };
  }
  lastEditable = picked.target;
  const described = describeTarget(picked.target);
  try {
    const adapter = new FieldAdapter(picked.target, lastRange, {
      appendAtEnd: picked.isFallback,
    });
    const insertedChars = adapter.insertText(normalized);
    const state: EngineProgress = {
      ...IDLE_PROGRESS,
      status: "completed",
      charsCompleted: countGraphemes(normalized),
      totalChars: countGraphemes(normalized),
      percent: 100,
      remainingMs: 0,
      startedAt: Date.now(),
      message: `Inserted ${insertedChars} characters directly.`,
      targetLabel: described.label,
    };
    engine = null;
    emitState(state);
    return success(state, { insertedChars, target: getFocusInfo() });
  } catch (error) {
    return failure(error);
  }
}

function pauseTyping(): CommandResponse {
  if (!engine) {
    return { ok: false, code: "BAD_STATE", error: "Nothing is running.", state: idleProgress() };
  }
  const state = engine.pause();
  return success(state);
}

function resumeTyping(): CommandResponse {
  if (!engine) {
    return { ok: false, code: "BAD_STATE", error: "Nothing is paused.", state: idleProgress() };
  }
  const state = engine.resume();
  return success(state);
}

function stopTyping(): CommandResponse {
  if (!engine) {
    return { ok: false, code: "BAD_STATE", error: "Nothing is running.", state: idleProgress() };
  }
  const state = engine.stop();
  return success(state);
}

function handleMessage(message: PopupToContentMessage): CommandResponse {
  switch (message.type) {
    case "TYPEFLOW_START":
      return startTyping(message.text, message.settings);
    case "TYPEFLOW_INSERT":
      return insertDirect(message.text);
    case "TYPEFLOW_PAUSE":
      return pauseTyping();
    case "TYPEFLOW_RESUME":
      return resumeTyping();
    case "TYPEFLOW_STOP":
      return stopTyping();
    case "TYPEFLOW_GET_STATE":
      return success(getEngineState(), { target: getFocusInfo() });
    default:
      return { ok: false, code: "INTERNAL", error: "Unknown command." };
  }
}

function rememberFocus(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const editable = closestEditable(target);
  if (editable) lastEditable = editable;
}

function rememberSelection(): void {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const container =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : (range.commonAncestorContainer as Element);
  if (closestEditable(container)) {
    lastRange = range.cloneRange();
  }
}

function install(): void {
  const pageWindow = window as Window & ContentApiGlobal;
  if (pageWindow.__typeflow) return;

  const api: ContentApi = {
    getFocusInfo,
    getEngineState,
    start: (text, settings) => startTyping(text, settings),
    pause: pauseTyping,
    resume: resumeTyping,
    stop: stopTyping,
    insertDirect,
  };
  pageWindow.__typeflow = api;

  document.addEventListener("focusin", rememberFocus, true);
  document.addEventListener("selectionchange", rememberSelection, true);
  lastEditable = closestEditable(getDeepActiveElement());
  rememberSelection();

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (!isPopupToContentMessage(message)) return false;
    sendResponse(handleMessage(message as PopupToContentMessage));
    return false;
  });

  const current = getEngineState();
  if (isActive(current.status)) {
    emitState(current);
  }
}

install();
