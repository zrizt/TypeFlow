import {
  ACTIVE_STATUSES,
  BRIDGE_SCRIPT_FILE,
  CONTENT_SCRIPT_FILE,
  DEFAULT_SETTINGS,
  IDLE_PROGRESS,
  SPEED_PRESETS,
} from "../shared/constants";
import { isFocusInfo, isFrameStateMessage } from "../shared/messages";
import type {
  CommandResponse,
  EngineProgress,
  FocusInfo,
  FrameReport,
  HistoryEntry,
  InsertionMethod,
  PopupToContentMessage,
  SpeedPreset,
  ThemePreference,
  TypingSettings,
  TypeFlowSettings,
} from "../shared/types";
import {
  addHistoryEntry,
  loadDraft,
  loadHistory,
  loadSettings,
  sanitizeSettings,
  sanitizeTypingSettings,
  saveDraft,
  saveHistory,
  saveSettings,
} from "../storage/storage";
import {
  countGraphemes,
  countWords,
  createId,
  formatDuration,
  formatInteger,
  previewText,
} from "../utils/text-utils";
import { delay } from "../utils/timer";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const elements = {
  editor: byId<HTMLTextAreaElement>("editor"),
  charCount: byId("char-count"),
  wordCount: byId("word-count"),
  copyBtn: byId<HTMLButtonElement>("copy-btn"),
  clearBtn: byId<HTMLButtonElement>("clear-btn"),
  historyBtn: byId<HTMLButtonElement>("history-btn"),
  historyPanel: byId("history-panel"),
  historyList: byId<HTMLUListElement>("history-list"),
  historyEmpty: byId("history-empty"),
  historyClear: byId<HTMLButtonElement>("history-clear"),
  methodHint: byId("method-hint"),
  typingSettings: byId("typing-settings"),
  settingsToggle: byId<HTMLButtonElement>("settings-toggle"),
  settingsBody: byId("settings-body"),
  customDelay: byId("custom-delay"),
  minDelay: byId<HTMLInputElement>("min-delay"),
  maxDelay: byId<HTMLInputElement>("max-delay"),
  paragraphPause: byId<HTMLInputElement>("paragraph-pause"),
  startDelay: byId<HTMLInputElement>("start-delay"),
  speedHint: byId("speed-hint"),
  statusPill: byId("status-pill"),
  progressCard: byId("progress-card"),
  progressTrack: byId("progress-track"),
  progressBar: byId("progress-bar"),
  progressChars: byId("progress-chars"),
  progressTotal: byId("progress-total"),
  progressPercent: byId("progress-percent"),
  progressEta: byId("progress-eta"),
  targetLine: byId("target-line"),
  siteAccessBtn: byId<HTMLButtonElement>("site-access-btn"),
  startBtn: byId<HTMLButtonElement>("start-btn"),
  pauseBtn: byId<HTMLButtonElement>("pause-btn"),
  pauseLabel: byId("pause-label"),
  stopBtn: byId<HTMLButtonElement>("stop-btn"),
  statusText: byId("status-text"),
  version: byId("version"),
  themeToggle: byId<HTMLButtonElement>("theme-toggle"),
  toast: byId("toast"),
};

const methodButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-method]"),
);
const speedButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-speed]"),
);

interface Notice {
  text: string;
  tone: "neutral" | "error" | "success";
}

interface PopupState {
  tabId: number | null;
  frameId: number | null;
  target: FocusInfo | null;
  settings: TypeFlowSettings;
  engine: EngineProgress;
  history: HistoryEntry[];
  historyOpen: boolean;
  settingsOpen: boolean;
  busy: boolean;
  busyLabel: string;
  notice: Notice | null;
  crossOriginFrame: string | null;
}

const state: PopupState = {
  tabId: null,
  frameId: null,
  target: null,
  settings: structuredClone(DEFAULT_SETTINGS),
  engine: { ...IDLE_PROGRESS },
  history: [],
  historyOpen: false,
  settingsOpen: false,
  busy: false,
  busyLabel: "",
  notice: null,
  crossOriginFrame: null,
};

const STATUS_LABELS: Record<EngineProgress["status"], string> = {
  idle: "Ready",
  countdown: "Starting",
  typing: "Typing",
  paused: "Paused",
  completed: "Completed",
  stopped: "Stopped",
  error: "Error",
};

const METHOD_HINTS: Record<InsertionMethod, string> = {
  direct: "Inserts the whole text at the cursor position in a single step.",
  typing: "Types the text one character at a time, with configurable delays.",
};

let draftTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let clearConfirmTimer: ReturnType<typeof setTimeout> | null = null;
let historyConfirmTimer: ReturnType<typeof setTimeout> | null = null;
let clearConfirming = false;
let historyConfirming = false;

const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return systemThemeQuery.matches ? "light" : "dark";
  }
  return preference;
}

function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference);
  const next = resolveTheme(preference) === "dark" ? "light" : "dark";
  elements.themeToggle.title = `Switch to ${next} theme`;
}

function persistSettings(): void {
  void saveSettings(state.settings).catch(() => {
    showToast("Could not save settings.", "error");
  });
}

function showToast(message: string, tone: "neutral" | "error" = "neutral"): void {
  if (toastTimer) clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  elements.toast.classList.toggle("is-error", tone === "error");
  requestAnimationFrame(() => {
    elements.toast.classList.add("is-visible");
  });
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    setTimeout(() => {
      elements.toast.hidden = true;
    }, 200);
  }, 2400);
}

function updateCounts(): void {
  const text = elements.editor.value;
  elements.charCount.textContent = formatInteger(countGraphemes(text));
  elements.wordCount.textContent = formatInteger(countWords(text));
  elements.copyBtn.disabled = text.length === 0;
  elements.clearBtn.disabled = text.length === 0;
  updateControls();
}

function scheduleDraftSave(): void {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    void saveDraft(elements.editor.value).catch(() => undefined);
  }, 300);
}

function currentTypingSettings(): TypingSettings {
  return sanitizeTypingSettings(state.settings.typing);
}

function readNumberInput(input: HTMLInputElement, fallback: number): number {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function syncNumberInputs(): void {
  const typing = state.settings.typing;
  elements.minDelay.value = String(typing.customMinDelay);
  elements.maxDelay.value = String(typing.customMaxDelay);
  elements.paragraphPause.value = String(typing.paragraphPause);
  elements.startDelay.value = String(typing.startDelay);
}

function commitNumericSettings(): void {
  const typing = currentTypingSettings();
  const next = sanitizeTypingSettings({
    ...typing,
    customMinDelay: readNumberInput(elements.minDelay, typing.customMinDelay),
    customMaxDelay: readNumberInput(elements.maxDelay, typing.customMaxDelay),
    paragraphPause: readNumberInput(elements.paragraphPause, typing.paragraphPause),
    startDelay: readNumberInput(elements.startDelay, typing.startDelay),
  });
  state.settings.typing = next;
  syncNumberInputs();
  renderSpeedHint();
  persistSettings();
  updateControls();
}

function renderSpeedHint(): void {
  const speed = state.settings.typing.speed;
  if (speed === "custom") {
    const { customMinDelay, customMaxDelay } = state.settings.typing;
    elements.speedHint.textContent = `Random delay between ${formatInteger(customMinDelay)} ms and ${formatInteger(customMaxDelay)} ms per character.`;
  } else {
    elements.speedHint.textContent = `${speed.charAt(0).toUpperCase() + speed.slice(1)} — ${SPEED_PRESETS[speed]} ms per character.`;
  }
}

function renderSettings(): void {
  const settings = state.settings;
  for (const button of methodButtons) {
    const selected = button.dataset.method === settings.method;
    button.setAttribute("aria-selected", selected ? "true" : "false");
  }
  for (const button of speedButtons) {
    const selected = button.dataset.speed === settings.typing.speed;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  elements.methodHint.textContent = METHOD_HINTS[settings.method];
  elements.typingSettings.hidden = settings.method !== "typing";
  elements.customDelay.hidden = settings.typing.speed !== "custom";
  elements.settingsBody.hidden = !state.settingsOpen;
  elements.settingsToggle.textContent = state.settingsOpen ? "Hide" : "Show";
  elements.settingsToggle.setAttribute(
    "aria-expanded",
    state.settingsOpen ? "true" : "false",
  );
  syncNumberInputs();
  renderSpeedHint();
}

function renderHistory(): void {
  elements.historyPanel.hidden = !state.historyOpen;
  elements.historyBtn.setAttribute("aria-expanded", state.historyOpen ? "true" : "false");
  elements.historyClear.disabled = state.history.length === 0;
  elements.historyEmpty.hidden = state.history.length > 0;
  elements.historyList.replaceChildren();

  for (const entry of state.history) {
    const item = document.createElement("li");
    item.className = "history-item";

    const textWrap = document.createElement("div");
    textWrap.className = "history-text";

    const preview = document.createElement("span");
    preview.className = "history-preview";
    preview.textContent = previewText(entry.text, 90);

    const meta = document.createElement("span");
    meta.className = "history-meta";
    const chars = formatInteger(countGraphemes(entry.text));
    const when = entry.createdAt
      ? new Date(entry.createdAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Saved text";
    meta.textContent = `${chars} chars · ${when}`;

    textWrap.append(preview, meta);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "ghost-btn";
    loadButton.dataset.action = "load";
    loadButton.dataset.id = entry.id;
    loadButton.textContent = "Load";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost-btn danger-text";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = entry.id;
    deleteButton.textContent = "Delete";

    actions.append(loadButton, deleteButton);
    item.append(textWrap, actions);
    elements.historyList.append(item);
  }
}

function recordHistory(text: string): void {
  if (!text.trim()) return;
  state.history = addHistoryEntry(state.history, text, createId());
  renderHistory();
  void saveHistory(state.history).catch(() => undefined);
}

function loadHistoryEntry(id: string): void {
  const entry = state.history.find((item) => item.id === id);
  if (!entry) return;
  elements.editor.value = entry.text;
  updateCounts();
  scheduleDraftSave();
  showToast("Saved text loaded.");
  state.historyOpen = false;
  renderHistory();
  elements.editor.focus({ preventScroll: true });
}

function deleteHistoryEntry(id: string): void {
  state.history = state.history.filter((item) => item.id !== id);
  renderHistory();
  void saveHistory(state.history).catch(() => undefined);
}

function resetClearConfirm(): void {
  clearConfirming = false;
  elements.clearBtn.textContent = "Clear";
  if (clearConfirmTimer) {
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = null;
  }
}

function resetHistoryConfirm(): void {
  historyConfirming = false;
  elements.historyClear.textContent = "Clear all";
  if (historyConfirmTimer) {
    clearTimeout(historyConfirmTimer);
    historyConfirmTimer = null;
  }
}

function handleClearClick(): void {
  if (elements.editor.value.length === 0) return;
  if (!clearConfirming) {
    clearConfirming = true;
    elements.clearBtn.textContent = "Confirm?";
    clearConfirmTimer = setTimeout(resetClearConfirm, 2600);
    return;
  }
  resetClearConfirm();
  elements.editor.value = "";
  updateCounts();
  void saveDraft("").catch(() => undefined);
  showToast("Text cleared.");
  elements.editor.focus({ preventScroll: true });
}

function handleHistoryClearClick(): void {
  if (state.history.length === 0) return;
  if (!historyConfirming) {
    historyConfirming = true;
    elements.historyClear.textContent = "Confirm?";
    historyConfirmTimer = setTimeout(resetHistoryConfirm, 2600);
    return;
  }
  resetHistoryConfirm();
  state.history = [];
  renderHistory();
  void saveHistory([]).catch(() => undefined);
  showToast("History cleared.");
}

async function copyText(): Promise<void> {
  const text = elements.editor.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard.");
  } catch {
    const start = elements.editor.selectionStart;
    const end = elements.editor.selectionEnd;
    elements.editor.focus();
    elements.editor.select();
    try {
      document.execCommand("copy");
      showToast("Copied to clipboard.");
    } catch {
      showToast("Could not copy automatically.", "error");
    }
    elements.editor.setSelectionRange(start, end);
  }
}

function setMethod(method: InsertionMethod): void {
  if (state.settings.method === method) return;
  state.settings.method = method;
  renderSettings();
  persistSettings();
  updateControls();
}

function setSpeed(speed: SpeedPreset): void {
  if (state.settings.typing.speed === speed) return;
  state.settings.typing.speed = speed;
  renderSettings();
  persistSettings();
}

function applyEngineState(next: EngineProgress, clearNotice = true): void {
  state.engine = next;
  if (clearNotice && next.status !== "idle") {
    state.notice = null;
  }
  render();
}

function isRunning(): boolean {
  return ACTIVE_STATUSES.has(state.engine.status);
}

function updateControls(): void {
  const hasText = elements.editor.value.trim().length > 0;
  const running = isRunning();
  const canStart =
    state.tabId !== null &&
    state.frameId !== null &&
    !!state.target &&
    hasText &&
    !running &&
    !state.busy;

  elements.startBtn.disabled = !canStart;
  elements.pauseBtn.disabled = !running || state.busy;
  elements.stopBtn.disabled = !running || state.busy;
  elements.pauseLabel.textContent = state.engine.status === "paused" ? "Resume" : "Pause";
  elements.pauseBtn.title =
    state.engine.status === "paused" ? "Resume typing" : "Pause typing";
  elements.startBtn.title = state.target
    ? "Start"
    : "Focus an editable field on the page first";
}

function renderTargetLine(): void {
  const label = state.target?.label || state.engine.targetLabel;
  const hasTarget = Boolean(label);
  const fallback = state.target?.isFallback === true;
  if (hasTarget) {
    elements.targetLine.textContent = `Target: ${label}${fallback ? " (largest field fallback)" : ""}`;
  } else {
    elements.targetLine.textContent = "No editable field detected";
  }
  elements.targetLine.classList.toggle(
    "is-error",
    !hasTarget && state.notice?.tone === "error",
  );
  elements.targetLine.title = elements.targetLine.textContent;

  const canGrantAccess = !hasTarget && Boolean(state.crossOriginFrame) && !state.busy;
  elements.siteAccessBtn.hidden = !canGrantAccess;
  elements.siteAccessBtn.disabled = !canGrantAccess;
  elements.siteAccessBtn.title = state.crossOriginFrame
    ? `Grant TypeFlow access to ${state.crossOriginFrame}`
    : "";
}

function renderStatus(): void {
  const engine = state.engine;
  const status = engine.status;
  let text = "Status: Ready";
  let tone: Notice["tone"] = "neutral";

  if (state.busy) {
    text = `Status: ${state.busyLabel || "Working…"}`;
  } else if (state.notice) {
    text = state.notice.text;
    tone = state.notice.tone;
  } else {
    switch (status) {
      case "countdown":
        text = `Status: ${engine.message || "Starting…"}`;
        break;
      case "typing":
        text = `Status: Typing — ${formatInteger(engine.charsCompleted)} of ${formatInteger(engine.totalChars)} characters`;
        break;
      case "paused":
        text = `Status: Paused — ${engine.percent}% complete`;
        break;
      case "completed":
        text = engine.message || "Status: Completed";
        tone = "success";
        break;
      case "stopped":
        text = engine.message || "Status: Stopped";
        break;
      case "error":
        text = engine.message || "Status: Error";
        tone = "error";
        break;
      case "idle":
      default:
        text = "Status: Ready";
        break;
    }
  }

  elements.statusText.textContent = text;
  elements.statusText.classList.toggle("is-error", tone === "error");
  elements.statusText.classList.toggle("is-success", tone === "success");
  elements.statusText.title = text;

  const pillLabel = STATUS_LABELS[status] ?? "Ready";
  elements.statusPill.textContent = state.busy ? "Working" : pillLabel;
  elements.statusPill.dataset.status = state.busy ? "typing" : status;
  elements.progressCard.dataset.status = status;
}

function renderProgress(): void {
  const engine = state.engine;
  const percent = Math.max(0, Math.min(100, engine.percent));
  elements.progressBar.style.width = `${percent}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
  elements.progressChars.textContent = formatInteger(engine.charsCompleted);
  elements.progressTotal.textContent = formatInteger(engine.totalChars);
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressEta.textContent = formatDuration(engine.remainingMs);
}

function render(): void {
  renderTargetLine();
  renderProgress();
  renderStatus();
  updateControls();
}

function setBusy(busy: boolean, label = "Working…"): void {
  state.busy = busy;
  state.busyLabel = label;
  render();
}

function scoreFrame(report: FrameReport): number {
  const { info } = report;
  if (ACTIVE_STATUSES.has(info.engine.status)) {
    return 100000 + (info.hasEditable ? 1000 : 0);
  }
  if (info.focused && info.hasEditable) return 50000;
  if (info.hasEditable && !info.isFallback) return 30000;
  if (info.hasEditable) return 10000;
  if (info.crossOriginFrame) return 500;
  return 0;
}

function pickBestFrame(reports: FrameReport[]): FrameReport | null {
  let best: FrameReport | null = null;
  for (const report of reports) {
    if (!best) {
      best = report;
      continue;
    }
    const diff = scoreFrame(report) - scoreFrame(best);
    if (diff > 0 || (diff === 0 && report.frameId < best.frameId)) {
      best = report;
    }
  }
  return best;
}

function probeContent(): unknown {
  const api = (
    window as Window & {
      __typeflow?: { getFocusInfo(): unknown };
    }
  ).__typeflow;
  return api ? api.getFocusInfo() : null;
}

async function probeFrames(tabId: number, allFrames: boolean): Promise<FrameReport[]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames },
    func: probeContent,
  });
  const reports: FrameReport[] = [];
  for (const result of results) {
    if (isFocusInfo(result.result)) {
      reports.push({ frameId: result.frameId, info: result.result });
    }
  }
  return reports;
}

async function collectReports(tabId: number): Promise<FrameReport[]> {
  const reports = new Map<number, FrameReport>();
  try {
    for (const report of await probeFrames(tabId, false)) {
      reports.set(report.frameId, report);
    }
  } catch {
    /* The main frame may be restricted; frame injection below will surface it. */
  }
  try {
    for (const report of await probeFrames(tabId, true)) {
      reports.set(report.frameId, report);
    }
  } catch {
    /* Cross-origin frames cannot always be inspected. The main frame is enough. */
  }
  return [...reports.values()];
}

async function injectContent(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [BRIDGE_SCRIPT_FILE],
      world: "MAIN",
    });
  } catch {
    /* The bridge is optional; content scripts still work without it. */
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch {
    /* Some subframes may be cross-origin or sandboxed. */
  }
}

async function ensureContentScripts(tabId: number): Promise<FrameReport[]> {
  await injectContent(tabId);
  await delay(50);
  const reports = await collectReports(tabId);
  if (reports.length === 0) {
    throw new Error("TypeFlow could not connect to this page.");
  }
  return reports;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /cannot access|cannot be scripted|extensions gallery|chrome:\/\/|edge:\/\/|about:|view-source/i.test(
      message,
    )
  ) {
    return "TypeFlow cannot run on this page. Open a normal website, click your text field, and try again.";
  }
  if (/no tab with id|tab was closed|frame with id|receiving end does not exist/i.test(message)) {
    return "The page is no longer available. Reopen the text field and try again.";
  }
  return message || "Something went wrong while contacting the page.";
}

async function refreshConnection(showBusy: boolean): Promise<boolean> {
  if (state.tabId === null) {
    state.notice = { text: "No active browser tab detected.", tone: "error" };
    state.target = null;
    state.frameId = null;
    state.crossOriginFrame = null;
    render();
    return false;
  }
  if (showBusy) setBusy(true, "Connecting to page…");
  try {
    const reports = await ensureContentScripts(state.tabId);
    const best = pickBestFrame(reports);
    if (!best) {
      throw new Error("TypeFlow could not connect to this page.");
    }
    state.frameId = best.frameId;
    state.target = best.info.hasEditable ? best.info : null;
    state.crossOriginFrame = best.info.crossOriginFrame ?? null;
    const engineActive = ACTIVE_STATUSES.has(best.info.engine.status);
    state.engine = best.info.engine;
    if (engineActive) {
      state.notice = null;
    } else if (!best.info.hasEditable) {
      const embeddedOrigin = best.info.crossOriginFrame;
      state.notice = {
        text: embeddedOrigin
          ? `The reply box is inside an embedded frame (${embeddedOrigin}). Grant access to that site so TypeFlow can reach it.`
          : "No editable field found. Click inside the reply box, then reopen TypeFlow. If the editor is inside an embedded frame, reload the page and try again.",
        tone: "error",
      };
    } else if (best.info.isFallback) {
      state.notice = {
        text: "No focused field detected — the largest text field on the page will be used.",
        tone: "neutral",
      };
    } else {
      state.notice = null;
    }
    return true;
  } catch (error) {
    state.notice = { text: friendlyError(error), tone: "error" };
    state.target = null;
    state.frameId = null;
    state.crossOriginFrame = null;
    return false;
  } finally {
    if (showBusy) setBusy(false);
    updateControls();
  }
}

async function handleSiteAccess(): Promise<void> {
  const origin = state.crossOriginFrame;
  if (!origin || state.busy) return;
  if (!chrome.permissions?.request) {
    showToast("Site access is not available in this browser.", "error");
    return;
  }
  let pattern: string;
  try {
    const url = new URL(origin);
    pattern = `${url.protocol}//${url.hostname}/*`;
  } catch {
    showToast("Could not identify the editor site.", "error");
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      showToast("Site access was not granted.", "error");
      return;
    }
    showToast("Site access granted. Rescanning…");
    await refreshConnection(true);
  } catch {
    showToast("Could not request site access.", "error");
  }
}

async function sendToFrame(
  frameId: number,
  message: PopupToContentMessage,
): Promise<CommandResponse> {
  if (state.tabId === null) {
    throw new Error("No active tab.");
  }
  const response = await chrome.tabs.sendMessage(state.tabId, message, { frameId });
  return response as CommandResponse;
}

async function handleStart(): Promise<void> {
  const text = elements.editor.value;
  if (!text.trim()) {
    showToast("Write or paste some text first.", "error");
    return;
  }
  if (state.busy || isRunning()) return;

  resetClearConfirm();
  const connected = await refreshConnection(true);
  if (!connected) return;
  if (!state.target || state.frameId === null) {
    showToast("Focus an editable field on the page first.", "error");
    return;
  }

  recordHistory(text);
  void saveDraft(text).catch(() => undefined);
  const frameId = state.frameId;
  const method = state.settings.method;
  setBusy(true, method === "direct" ? "Inserting text…" : "Starting typing…");

  try {
    const message: PopupToContentMessage =
      method === "direct"
        ? { type: "TYPEFLOW_INSERT", text }
        : {
            type: "TYPEFLOW_START",
            text,
            settings: currentTypingSettings(),
          };

    const response = await sendToFrame(frameId, message);
    if (response.target) {
      state.target = response.target.hasEditable ? response.target : state.target;
    }
    if (response.state) {
      state.engine = response.state;
    }
    if (!response.ok) {
      state.notice = {
        text: response.error ?? "The page rejected the request.",
        tone: "error",
      };
    } else {
      state.notice = null;
      if (method === "direct") {
        showToast(`Inserted ${formatInteger(response.insertedChars ?? 0)} characters.`);
      }
    }
  } catch (error) {
    state.notice = { text: friendlyError(error), tone: "error" };
  } finally {
    setBusy(false);
  }
}

async function handlePause(): Promise<void> {
  if (state.frameId === null || state.busy) return;
  const resuming = state.engine.status === "paused";
  try {
    const response = await sendToFrame(state.frameId, {
      type: resuming ? "TYPEFLOW_RESUME" : "TYPEFLOW_PAUSE",
    });
    if (response.state) state.engine = response.state;
    if (!response.ok) {
      state.notice = { text: response.error ?? "Could not change pause state.", tone: "error" };
    } else {
      state.notice = null;
    }
  } catch (error) {
    state.notice = { text: friendlyError(error), tone: "error" };
  }
  render();
}

async function handleStop(): Promise<void> {
  if (state.frameId === null || state.busy) return;
  setBusy(true, "Stopping…");
  try {
    const response = await sendToFrame(state.frameId, { type: "TYPEFLOW_STOP" });
    if (response.state) state.engine = response.state;
    if (!response.ok) {
      state.notice = { text: response.error ?? "Could not stop typing.", tone: "error" };
    } else {
      state.notice = null;
    }
  } catch (error) {
    state.notice = { text: friendlyError(error), tone: "error" };
  } finally {
    setBusy(false);
  }
}

function bindEvents(): void {
  elements.editor.addEventListener("input", () => {
    updateCounts();
    scheduleDraftSave();
    if (clearConfirming) resetClearConfirm();
  });
  elements.editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void handleStart();
    }
  });

  elements.copyBtn.addEventListener("click", () => {
    void copyText();
  });
  elements.clearBtn.addEventListener("click", handleClearClick);
  elements.historyBtn.addEventListener("click", () => {
    state.historyOpen = !state.historyOpen;
    renderHistory();
  });
  elements.historyClear.addEventListener("click", handleHistoryClearClick);
  elements.historyList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    if (!id) return;
    if (button.dataset.action === "load") {
      loadHistoryEntry(id);
    } else if (button.dataset.action === "delete") {
      deleteHistoryEntry(id);
    }
  });

  for (const button of methodButtons) {
    button.addEventListener("click", () => {
      const method = button.dataset.method;
      if (method === "direct" || method === "typing") setMethod(method);
    });
  }
  for (const button of speedButtons) {
    button.addEventListener("click", () => {
      const speed = button.dataset.speed;
      if (
        speed === "slow" ||
        speed === "normal" ||
        speed === "fast" ||
        speed === "custom"
      ) {
        setSpeed(speed);
      }
    });
  }

  for (const input of [
    elements.minDelay,
    elements.maxDelay,
    elements.paragraphPause,
    elements.startDelay,
  ]) {
    input.addEventListener("change", commitNumericSettings);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  }

  elements.settingsToggle.addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    renderSettings();
  });

  elements.themeToggle.addEventListener("click", () => {
    const resolved = resolveTheme(state.settings.theme);
    state.settings.theme = resolved === "dark" ? "light" : "dark";
    applyTheme(state.settings.theme);
    persistSettings();
  });

  systemThemeQuery.addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme("system");
  });

  elements.siteAccessBtn.addEventListener("click", () => {
    void handleSiteAccess();
  });
  elements.startBtn.addEventListener("click", () => {
    void handleStart();
  });
  elements.pauseBtn.addEventListener("click", () => {
    void handlePause();
  });
  elements.stopBtn.addEventListener("click", () => {
    void handleStop();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isRunning()) {
      event.preventDefault();
      void handleStop();
    }
  });

  window.addEventListener("pagehide", () => {
    void saveDraft(elements.editor.value).catch(() => undefined);
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isFrameStateMessage(message)) return false;
    if (sender.tab?.id !== state.tabId) return false;
    if (state.frameId !== null && sender.frameId !== state.frameId) return false;
    if (state.frameId === null && typeof sender.frameId === "number") {
      state.frameId = sender.frameId;
    }
    applyEngineState(message.state);
    return false;
  });
}

async function getActiveTab(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  elements.version.textContent = chrome.runtime.getManifest().version;

  const [settings, draft, history] = await Promise.all([
    loadSettings(),
    loadDraft(),
    loadHistory(),
  ]);
  state.settings = sanitizeSettings(settings);
  state.history = history;
  applyTheme(state.settings.theme);
  if (draft?.text) {
    elements.editor.value = draft.text;
  }

  bindEvents();
  updateCounts();
  renderHistory();
  renderSettings();

  state.tabId = await getActiveTab();
  if (state.tabId === null) {
    state.notice = { text: "No active tab detected.", tone: "error" };
    render();
    return;
  }

  await refreshConnection(true);
  elements.editor.focus({ preventScroll: true });
  const length = elements.editor.value.length;
  elements.editor.setSelectionRange(length, length);
}

applyTheme(state.settings.theme);
void init();
