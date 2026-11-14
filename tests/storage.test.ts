import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, HISTORY_LIMIT, LIMITS } from "../src/shared/constants.ts";
import {
  addHistoryEntry,
  sanitizeDraft,
  sanitizeHistory,
  sanitizeSettings,
  sanitizeTypingSettings,
} from "../src/storage/storage.ts";

test("sanitizeSettings falls back to defaults for invalid input", () => {
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings("nope"), DEFAULT_SETTINGS);
  assert.deepEqual(
    sanitizeSettings({ method: "hack", theme: "neon", typing: { speed: "warp" } }),
    DEFAULT_SETTINGS,
  );
});

test("sanitizeSettings clamps delays and enforces min <= max", () => {
  const settings = sanitizeSettings({
    method: "direct",
    theme: "light",
    typing: {
      speed: "custom",
      customMinDelay: 9000,
      customMaxDelay: 5,
      paragraphPause: -20,
      startDelay: 999,
    },
  });

  assert.equal(settings.method, "direct");
  assert.equal(settings.theme, "light");
  assert.equal(settings.typing.speed, "custom");
  assert.equal(settings.typing.customMinDelay, LIMITS.customMinDelay.max);
  assert.ok(settings.typing.customMaxDelay >= settings.typing.customMinDelay);
  assert.equal(settings.typing.paragraphPause, 0);
  assert.equal(settings.typing.startDelay, LIMITS.startDelay.max);
});

test("sanitizeTypingSettings handles non-finite numbers", () => {
  const typing = sanitizeTypingSettings({
    speed: "custom",
    customMinDelay: Number.NaN,
    customMaxDelay: Number.POSITIVE_INFINITY,
    paragraphPause: Number.NaN,
    startDelay: Number.NaN,
  });
  assert.equal(typing.customMinDelay, DEFAULT_SETTINGS.typing.customMinDelay);
  assert.equal(typing.customMaxDelay, DEFAULT_SETTINGS.typing.customMaxDelay);
  assert.equal(typing.paragraphPause, DEFAULT_SETTINGS.typing.paragraphPause);
  assert.equal(typing.startDelay, DEFAULT_SETTINGS.typing.startDelay);
});

test("sanitizeDraft rejects empty drafts and keeps text", () => {
  assert.equal(sanitizeDraft(null), null);
  assert.equal(sanitizeDraft({ text: "" }), null);
  const draft = sanitizeDraft({ text: "Halo", updatedAt: 123 });
  assert.equal(draft?.text, "Halo");
  assert.equal(draft?.updatedAt, 123);
});

test("sanitizeHistory deduplicates, filters and caps entries", () => {
  const raw = [
    { id: "a", text: "Satu", createdAt: 1 },
    { id: "a", text: "Satu", createdAt: 1 },
    { id: "b", text: "   " },
    { id: "c", text: "Dua", createdAt: 2 },
    null,
  ];
  const history = sanitizeHistory(raw);
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((entry) => entry.text),
    ["Satu", "Dua"],
  );

  const many = Array.from({ length: HISTORY_LIMIT + 10 }, (_, index) => ({
    id: String(index),
    text: `Teks ${index}`,
    createdAt: index,
  }));
  assert.equal(sanitizeHistory(many).length, HISTORY_LIMIT);
});

test("addHistoryEntry puts newest first and removes duplicates", () => {
  let history = addHistoryEntry([], "Pertama", "id-1");
  history = addHistoryEntry(history, "Kedua", "id-2");
  history = addHistoryEntry(history, "Pertama", "id-3");
  assert.deepEqual(
    history.map((entry) => entry.text),
    ["Pertama", "Kedua"],
  );
  assert.equal(history[0]?.id, "id-3");
  assert.equal(addHistoryEntry(history, "   ", "id-4"), history);
});
