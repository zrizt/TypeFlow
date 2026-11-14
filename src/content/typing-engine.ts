import { IDLE_PROGRESS, SPEED_PRESETS } from "../shared/constants";
import type {
  EngineProgress,
  EngineStatus,
  TypingSettings,
} from "../shared/types";
import { countGraphemes, normalizeNewlines, splitGraphemes } from "../utils/text-utils";
import { delay, randomInteger } from "../utils/timer";
import { InsertionError } from "./insertion";

export interface TextSink {
  insertText(text: string): number;
  isAlive(): boolean;
}

interface EngineOptions {
  targetLabel: string;
  onUpdate?: (state: EngineProgress) => void;
}

const EMIT_INTERVAL_MS = 80;

export class TypingEngine {
  private status: EngineStatus = "idle";
  private chars: string[] = [];
  private index = 0;
  private total = 0;
  private newlinesRemaining = 0;
  private settings: TypingSettings;
  private sink: TextSink | null = null;
  private targetLabel = "";
  private message = "";
  private runId = 0;
  private paused = false;
  private pausedPhase: "countdown" | "typing" | null = null;
  private countdownRemainingMs = 0;
  private startedAt: number | null = null;
  private lastEmitAt = 0;
  private onUpdate: ((state: EngineProgress) => void) | null;

  constructor(settings: TypingSettings, options: EngineOptions) {
    this.settings = settings;
    this.targetLabel = options.targetLabel;
    this.onUpdate = options.onUpdate ?? null;
  }

  isRunning(): boolean {
    return (
      this.status === "countdown" ||
      this.status === "typing" ||
      this.status === "paused"
    );
  }

  snapshot(): EngineProgress {
    return {
      status: this.status,
      charsCompleted: this.index,
      totalChars: this.total,
      percent: this.total > 0 ? Math.min(100, Math.round((this.index / this.total) * 1000) / 10) : 0,
      remainingMs: this.estimateRemainingMs(),
      startedAt: this.startedAt,
      message: this.message,
      targetLabel: this.targetLabel,
      pausedPhase: this.pausedPhase,
    };
  }

  start(text: string, settings: TypingSettings, sink: TextSink): EngineProgress {
    const normalized = normalizeNewlines(text);
    if (!normalized.trim()) {
      this.status = "error";
      this.message = "There is no text to type.";
      this.emit(true);
      return this.snapshot();
    }

    this.runId += 1;
    this.settings = settings;
    this.chars = splitGraphemes(normalized);
    this.index = 0;
    this.total = this.chars.length;
    this.newlinesRemaining = normalized.split("").filter((char) => char === "\n").length;
    this.sink = sink;
    this.paused = false;
    this.pausedPhase = null;
    this.startedAt = null;
    this.countdownRemainingMs = Math.max(0, settings.startDelay) * 1000;
    this.status = this.countdownRemainingMs > 0 ? "countdown" : "typing";
    this.message =
      this.status === "countdown"
        ? `Starting in ${Math.ceil(this.countdownRemainingMs / 1000)}s`
        : "Typing…";
    const runId = this.runId;
    this.emit(true);
    void this.run(runId);
    return this.snapshot();
  }

  pause(): EngineProgress {
    if (this.status === "countdown" || this.status === "typing") {
      this.paused = true;
      this.pausedPhase = this.status;
      this.status = "paused";
      this.message = "Paused";
      this.emit(true);
    }
    return this.snapshot();
  }

  resume(): EngineProgress {
    if (this.status === "paused") {
      this.status = this.pausedPhase ?? "typing";
      this.paused = false;
      this.message = this.status === "countdown" ? "Starting…" : "Typing…";
      this.pausedPhase = null;
      this.emit(true);
    }
    return this.snapshot();
  }

  stop(): EngineProgress {
    if (!this.isRunning()) return this.snapshot();
    this.runId += 1;
    this.paused = false;
    this.pausedPhase = null;
    this.status = "stopped";
    this.message = `Stopped after ${this.index} of ${this.total} characters.`;
    this.sink = null;
    this.emit(true);
    return this.snapshot();
  }

  reset(): EngineProgress {
    if (this.isRunning()) this.stop();
    this.runId += 1;
    this.status = "idle";
    this.chars = [];
    this.index = 0;
    this.total = 0;
    this.newlinesRemaining = 0;
    this.sink = null;
    this.startedAt = null;
    this.message = "";
    this.pausedPhase = null;
    this.emit(true);
    return this.snapshot();
  }

  private async run(runId: number): Promise<void> {
    try {
      if (!(await this.runCountdown(runId))) return;
      this.status = "typing";
      this.startedAt = Date.now();
      this.message = "Typing…";
      this.emit(true);

      for (; this.index < this.total; this.index += 1) {
        if (runId !== this.runId) return;
        if (!(await this.waitWhilePaused(runId))) return;

        const char = this.chars[this.index];
        if (char === undefined) break;
        if (!this.sink || !this.sink.isAlive()) {
          throw new InsertionError(
            "TARGET_GONE",
            "The target field was removed or became read-only while typing.",
          );
        }

        this.sink.insertText(char);
        if (char === "\n") {
          this.newlinesRemaining = Math.max(0, this.newlinesRemaining - 1);
        }
        this.emit(false);

        const waitMs = this.delayForChar() + (char === "\n" ? this.settings.paragraphPause : 0);
        if (!(await this.wait(waitMs, runId))) return;
      }

      if (runId !== this.runId) return;
      this.status = "completed";
      this.message = `Done — typed ${this.total} characters.`;
      this.startedAt = this.startedAt ?? Date.now();
      this.emit(true);
    } catch (error) {
      if (runId !== this.runId) return;
      this.status = "error";
      this.paused = false;
      this.pausedPhase = null;
      this.message =
        error instanceof Error ? error.message : "Typing failed unexpectedly.";
      this.emit(true);
    }
  }

  private async runCountdown(runId: number): Promise<boolean> {
    if (this.status !== "countdown") {
      this.countdownRemainingMs = 0;
      return true;
    }
    while (this.countdownRemainingMs > 0) {
      if (runId !== this.runId) return false;
      if (!(await this.waitWhilePaused(runId))) return false;
      const chunk = Math.min(200, this.countdownRemainingMs);
      const started = Date.now();
      await delay(chunk);
      if (runId !== this.runId) return false;
      if (!this.paused) {
        this.countdownRemainingMs = Math.max(
          0,
          this.countdownRemainingMs - (Date.now() - started),
        );
      }
      this.message =
        this.countdownRemainingMs > 0
          ? `Starting in ${Math.ceil(this.countdownRemainingMs / 1000)}s`
          : "Typing…";
      this.emit(false);
    }
    this.countdownRemainingMs = 0;
    return true;
  }

  private async waitWhilePaused(runId: number): Promise<boolean> {
    while (this.paused) {
      if (runId !== this.runId) return false;
      await delay(50);
    }
    return runId === this.runId;
  }

  private async wait(ms: number, runId: number): Promise<boolean> {
    let remaining = Math.max(0, ms);
    while (remaining > 0) {
      if (runId !== this.runId) return false;
      if (this.paused) {
        if (!(await this.waitWhilePaused(runId))) return false;
        continue;
      }
      const chunk = Math.min(50, remaining);
      const started = Date.now();
      await delay(chunk);
      if (runId !== this.runId) return false;
      if (!this.paused) {
        remaining -= Date.now() - started;
      }
    }
    return true;
  }

  private delayForChar(): number {
    const { speed, customMinDelay, customMaxDelay } = this.settings;
    if (speed === "custom") {
      return randomInteger(customMinDelay, customMaxDelay);
    }
    return SPEED_PRESETS[speed];
  }

  private averageDelay(): number {
    const { speed, customMinDelay, customMaxDelay } = this.settings;
    if (speed === "custom") {
      return (customMinDelay + customMaxDelay) / 2;
    }
    return SPEED_PRESETS[speed];
  }

  private estimateRemainingMs(): number | null {
    if (
      this.status !== "countdown" &&
      this.status !== "typing" &&
      this.status !== "paused"
    ) {
      if (this.status === "completed") return 0;
      return null;
    }
    const charsRemaining = Math.max(0, this.total - this.index);
    const typingMs =
      charsRemaining * this.averageDelay() +
      this.newlinesRemaining * this.settings.paragraphPause;
    const countdownMs = this.status === "countdown" ? this.countdownRemainingMs : 0;
    return Math.round(typingMs + countdownMs);
  }

  private emit(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastEmitAt < EMIT_INTERVAL_MS) return;
    this.lastEmitAt = now;
    this.onUpdate?.(this.snapshot());
  }
}

export function idleProgress(): EngineProgress {
  return { ...IDLE_PROGRESS };
}

export function charsInText(text: string): number {
  return countGraphemes(normalizeNewlines(text));
}
