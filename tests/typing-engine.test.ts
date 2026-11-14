import test from "node:test";
import assert from "node:assert/strict";
import { TypingEngine, type TextSink } from "../src/content/typing-engine.ts";
import type { TypingSettings } from "../src/shared/types.ts";

const FAST_SETTINGS: TypingSettings = {
  speed: "custom",
  customMinDelay: 1,
  customMaxDelay: 1,
  paragraphPause: 0,
  startDelay: 0,
};

function sinkFor(onInsert?: (char: string, index: number) => void): TextSink & {
  text: string;
  alive: boolean;
  inserts: number;
} {
  const sink = {
    text: "",
    alive: true,
    inserts: 0,
    insertText(char: string): number {
      onInsert?.(char, sink.inserts);
      sink.text += char;
      sink.inserts += 1;
      return 1;
    },
    isAlive(): boolean {
      return sink.alive;
    },
  };
  return sink;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for engine state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function makeEngine(settings: TypingSettings = FAST_SETTINGS): TypingEngine {
  return new TypingEngine(settings, { targetLabel: "textarea — test" });
}

test("types every grapheme and preserves Unicode", async () => {
  const engine = makeEngine();
  const sink = sinkFor();
  const text = "Halo, dunia!\nBaris kedua 👍🏽";
  engine.start(text, FAST_SETTINGS, sink);

  await waitFor(() => engine.snapshot().status === "completed");

  const state = engine.snapshot();
  assert.equal(sink.text, text);
  assert.equal(state.status, "completed");
  assert.equal(state.percent, 100);
  assert.equal(state.charsCompleted, state.totalChars);
  assert.equal(state.remainingMs, 0);
});

test("pause freezes progress until resumed", async () => {
  const settings: TypingSettings = {
    ...FAST_SETTINGS,
    customMinDelay: 20,
    customMaxDelay: 20,
  };
  const engine = makeEngine(settings);
  const sink = sinkFor();
  engine.start("abcdefghijklmnopqrst", settings, sink);

  await waitFor(() => engine.snapshot().charsCompleted >= 3);
  engine.pause();
  assert.equal(engine.snapshot().status, "paused");

  const pausedAt = sink.inserts;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(sink.inserts, pausedAt);

  engine.resume();
  await waitFor(() => engine.snapshot().status === "completed");
  assert.equal(sink.text, "abcdefghijklmnopqrst");
});

test("stop halts immediately and keeps partial progress", async () => {
  const settings: TypingSettings = {
    ...FAST_SETTINGS,
    customMinDelay: 15,
    customMaxDelay: 15,
  };
  const engine = makeEngine(settings);
  const sink = sinkFor();
  engine.start("01234567890123456789", settings, sink);

  await waitFor(() => engine.snapshot().charsCompleted >= 2);
  const state = engine.stop();
  assert.equal(state.status, "stopped");
  const stoppedAt = sink.inserts;

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(sink.inserts, stoppedAt);
  assert.ok(state.charsCompleted < state.totalChars);
});

test("reports TARGET_GONE when the field disappears", async () => {
  const settings: TypingSettings = {
    ...FAST_SETTINGS,
    customMinDelay: 5,
    customMaxDelay: 5,
  };
  const engine = makeEngine(settings);
  const sink = sinkFor((_char, index) => {
    if (index === 2) sink.alive = false;
  });
  engine.start("abcdefghij", settings, sink);

  await waitFor(() => engine.snapshot().status === "error");
  const state = engine.snapshot();
  assert.equal(state.status, "error");
  assert.match(state.message, /removed|read-only/i);
});

test("countdown pauses and stop cancels before typing", async () => {
  const settings: TypingSettings = {
    ...FAST_SETTINGS,
    startDelay: 2,
  };
  const engine = makeEngine(settings);
  const sink = sinkFor();
  engine.start("abc", settings, sink);

  await waitFor(() => engine.snapshot().status === "countdown");
  engine.pause();
  assert.equal(engine.snapshot().status, "paused");
  assert.equal(engine.snapshot().pausedPhase, "countdown");

  const stopped = engine.stop();
  assert.equal(stopped.status, "stopped");

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(sink.inserts, 0);
});

test("empty text is rejected", () => {
  const engine = makeEngine();
  const sink = sinkFor();
  const state = engine.start("   ", FAST_SETTINGS, sink);
  assert.equal(state.status, "error");
  assert.equal(sink.inserts, 0);
});
