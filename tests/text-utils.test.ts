import test from "node:test";
import assert from "node:assert/strict";
import {
  countGraphemes,
  countNewlines,
  countWords,
  formatDuration,
  formatInteger,
  normalizeNewlines,
  previewText,
  splitGraphemes,
  truncate,
} from "../src/utils/text-utils.ts";

test("normalizeNewlines converts CRLF and CR to LF", () => {
  assert.equal(normalizeNewlines("a\r\nb\rc\nd"), "a\nb\nc\nd");
});

test("countGraphemes handles Unicode, Indonesian text and emoji", () => {
  assert.equal(countGraphemes("Halo dunia"), 10);
  assert.equal(countGraphemes("café"), 4);
  assert.equal(countGraphemes("👨‍👩‍👧‍👦"), 1);
  assert.equal(countGraphemes("Selamat pagi 🌅"), 14);
  assert.equal(countGraphemes(""), 0);
});

test("splitGraphemes preserves multi-code-point graphemes", () => {
  assert.deepEqual(splitGraphemes("a👍🏽b"), ["a", "👍🏽", "b"]);
  assert.deepEqual(splitGraphemes("e\u0301"), ["e\u0301"]);
});

test("countWords counts Indonesian words and punctuation", () => {
  assert.equal(countWords("Halo, dunia! Ini uji coba."), 5);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("kata-kata dan don't"), 4);
});

test("countNewlines counts paragraph breaks", () => {
  assert.equal(countNewlines("satu\n\ndua\ntiga"), 3);
  assert.equal(countNewlines("tanpa baris baru"), 0);
});

test("formatDuration renders seconds, minutes and hours", () => {
  assert.equal(formatDuration(null), "--");
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(999), "1s");
  assert.equal(formatDuration(75_000), "1m 15s");
  assert.equal(formatDuration(3_660_000), "1h 01m");
});

test("formatInteger uses grouped digits", () => {
  assert.equal(formatInteger(1234567), "1,234,567");
  assert.equal(formatInteger(-5), "0");
});

test("truncate and previewText protect layout", () => {
  assert.equal(truncate("abcdef", 4), "abc…");
  assert.equal(truncate("abc", 4), "abc");
  assert.equal(previewText("  halo \n\n dunia  ", 20), "halo dunia");
  assert.equal(previewText("   "), "(empty)");
});
