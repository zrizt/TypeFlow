import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/constants";
import { isFrameStateMessage } from "../shared/messages";
import type { EngineProgress } from "../shared/types";
import { sanitizeSettings } from "../storage/storage";

const clearTimers = new Map<number, ReturnType<typeof setTimeout>>();

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
      const existing = stored[STORAGE_KEYS.settings];
      if (!existing) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.settings]: sanitizeSettings(DEFAULT_SETTINGS),
        });
      }
      await chrome.storage.local.set({
        [STORAGE_KEYS.installedVersion]: chrome.runtime.getManifest().version,
      });
    } catch {
      /* Storage failures should never block installation. */
    }
  }
});

function scheduleBadgeClear(tabId: number, delayMs: number): void {
  const existing = clearTimers.get(tabId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    clearTimers.delete(tabId);
    void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
  }, delayMs);
  clearTimers.set(tabId, timer);
}

function updateBadge(tabId: number, state: EngineProgress): void {
  const existing = clearTimers.get(tabId);
  if (existing) {
    clearTimeout(existing);
    clearTimers.delete(tabId);
  }

  let text = "";
  let color = "#6366f1";
  switch (state.status) {
    case "countdown":
      text = "…";
      color = "#f59e0b";
      break;
    case "typing":
      text = `${Math.min(99, Math.round(state.percent))}`;
      color = "#6366f1";
      break;
    case "paused":
      text = "II";
      color = "#f59e0b";
      break;
    case "completed":
      text = "✓";
      color = "#10b981";
      break;
    case "error":
      text = "!";
      color = "#ef4444";
      break;
    case "stopped":
    case "idle":
    default:
      text = "";
      break;
  }

  void chrome.action
    .setBadgeBackgroundColor({ tabId, color })
    .catch(() => undefined);
  void chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);

  if (state.status === "completed") scheduleBadgeClear(tabId, 4000);
  if (state.status === "error") scheduleBadgeClear(tabId, 6000);
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isFrameStateMessage(message)) return false;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return false;
  updateBadge(tabId, message.state);
  return false;
});
