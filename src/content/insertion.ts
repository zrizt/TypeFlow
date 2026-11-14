import { PASTE_REQUEST_EVENT } from "../shared/constants";
import type { ErrorCode, TargetKind } from "../shared/types";
import {
  describeElement,
  getDeepActiveElement,
  isVisible,
  parentAcrossShadow,
} from "../utils/dom-utils";
import { countGraphemes, normalizeNewlines } from "../utils/text-utils";

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
]);

export class InsertionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "InsertionError";
    this.code = code;
  }
}

export function isTextControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    return (
      TEXT_INPUT_TYPES.has((element.type || "text").toLowerCase()) &&
      !element.disabled &&
      !element.readOnly
    );
  }
  return false;
}

export function isContentEditableElement(element: Element): boolean {
  if (element instanceof HTMLElement && element.isContentEditable === true) {
    return true;
  }
  let node: Element | null = element;
  while (node) {
    const attr = node.getAttribute("contenteditable");
    if (attr !== null) {
      return attr === "" || attr === "true" || attr === "plaintext-only";
    }
    node = parentAcrossShadow(node);
  }
  return false;
}

export function isEditableElement(element: Element | null): element is HTMLElement {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (isTextControl(element)) return true;
  if (isContentEditableElement(element)) {
    if (element.getAttribute("aria-disabled") === "true") return false;
    return true;
  }
  return false;
}

export function closestEditable(element: Element | null): HTMLElement | null {
  let node: Element | null = element;
  while (node) {
    if (isEditableElement(node)) return node;
    node = parentAcrossShadow(node);
  }
  return null;
}

const EDITABLE_SELECTOR =
  'textarea, input, [contenteditable], [role="textbox"], .ql-editor, .ProseMirror, .ck-editor__editable, .mce-content-body';

function collectCandidates(root: Document | ShadowRoot): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR)) {
    found.add(element);
  }
  if (root instanceof Document && root.designMode === "on" && root.body) {
    found.add(root.body);
  }
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (element.shadowRoot) {
      for (const nested of collectCandidates(element.shadowRoot)) {
        found.add(nested);
      }
    }
  }
  return [...found];
}

export function findFallbackTarget(): HTMLElement | null {
  const candidates = collectCandidates(document);
  let best: HTMLElement | null = null;
  let bestScore = 0;
  const viewportWidth = window.innerWidth || 1;
  const viewportHeight = window.innerHeight || 1;

  for (const candidate of candidates) {
    if (!isEditableElement(candidate) || !isVisible(candidate)) continue;
    const rect = candidate.getBoundingClientRect();
    let score = Math.max(1, rect.width) * Math.max(1, rect.height);
    const inViewport =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < viewportHeight &&
      rect.left < viewportWidth;
    if (inViewport) score *= 2;
    if (candidate instanceof HTMLTextAreaElement) score *= 1.2;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function resolveTarget(): HTMLElement | null {
  const active = getDeepActiveElement();
  const activeEditable = closestEditable(active);
  if (activeEditable) return activeEditable;
  return findFallbackTarget();
}

export function describeTarget(element: HTMLElement): { kind: TargetKind; label: string } {
  return describeElement(element);
}

export function targetKind(element: HTMLElement): TargetKind {
  return describeElement(element).kind;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPasteEvent(doc: Document, text: string): ClipboardEvent | null {
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    data.setData("text/html", escapeHtml(text).replace(/\r?\n/g, "<br>"));
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    return event;
  } catch {
    return null;
  }
}

function fireBeforeInput(
  element: HTMLElement,
  text: string,
  inputType: string,
): boolean {
  try {
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType,
      data: text,
    });
    return element.dispatchEvent(event);
  } catch {
    const event = new Event("beforeinput", { bubbles: true, cancelable: true });
    return element.dispatchEvent(event);
  }
}

function fireInput(element: HTMLElement, text: string): void {
  try {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "insertText",
        data: text,
      }),
    );
  } catch {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

export interface FieldAdapterOptions {
  appendAtEnd?: boolean;
}

export class FieldAdapter {
  readonly element: HTMLElement;
  private readonly kind: TargetKind;
  private selectionStart = 0;
  private selectionEnd = 0;
  private range: Range | null = null;
  private contentStrategy: "unknown" | "exec" | "paste" | "dom" = "unknown";
  private insertedSinceCheck = 0;
  private pendingText = "";
  private lastSnapshot = "";

  constructor(
    element: HTMLElement,
    initialRange?: Range | null,
    options: FieldAdapterOptions = {},
  ) {
    if (!isEditableElement(element)) {
      throw new InsertionError("NO_TARGET", "The selected element is no longer editable.");
    }
    this.element = element;
    this.kind = targetKind(element);
    if (this.kind === "contenteditable") {
      this.range = options.appendAtEnd
        ? this.rangeAtEnd()
        : initialRange && element.contains(initialRange.commonAncestorContainer)
          ? initialRange.cloneRange()
          : this.captureLiveRange();
      if (!this.range) this.range = this.rangeAtEnd();
      this.lastSnapshot = element.innerHTML;
    } else {
      const control = element as HTMLInputElement | HTMLTextAreaElement;
      if (options.appendAtEnd) {
        this.selectionStart = control.value.length;
        this.selectionEnd = control.value.length;
      } else {
        const { start, end } = this.readSelection(control);
        this.selectionStart = start;
        this.selectionEnd = end;
      }
    }
  }

  isAlive(): boolean {
    return this.element.isConnected && isEditableElement(this.element);
  }

  insertText(rawText: string): number {
    if (!this.isAlive()) {
      throw new InsertionError("TARGET_GONE", "The target field is no longer available.");
    }
    const text = normalizeNewlines(rawText);
    if (!text) return 0;
    if (this.kind === "contenteditable") {
      this.insertIntoContentEditable(text);
    } else {
      this.insertIntoControl(text);
    }
    return countGraphemes(text);
  }

  private insertIntoControl(text: string): void {
    const control = this.element as HTMLInputElement | HTMLTextAreaElement;
    const current = control.value;
    if (control.maxLength >= 0) {
      const available = control.maxLength - (current.length - (this.selectionEnd - this.selectionStart));
      if (available <= 0) {
        throw new InsertionError(
          "BLOCKED",
          "The field has reached its maximum length and rejected the text.",
        );
      }
    }

    const start = Math.min(this.selectionStart, current.length);
    const end = Math.min(Math.max(this.selectionEnd, start), current.length);
    const nextValue = current.slice(0, start) + text + current.slice(end);

    if (!fireBeforeInput(control, text, "insertText")) {
      throw new InsertionError(
        "BLOCKED",
        "The page prevented programmatic text input (beforeinput was cancelled).",
      );
    }

    setNativeValue(control, nextValue);
    const caret = start + text.length;
    try {
      control.setSelectionRange(caret, caret);
    } catch {
      /* Some input types do not support selection ranges. */
    }
    fireInput(control, text);

    if (control.value !== nextValue) {
      throw new InsertionError(
        "BLOCKED",
        "The field rejected the text. A site script may be controlling its value.",
      );
    }
    this.selectionStart = caret;
    this.selectionEnd = caret;
  }

  private readSelection(control: HTMLInputElement | HTMLTextAreaElement): {
    start: number;
    end: number;
  } {
    try {
      const start = control.selectionStart ?? control.value.length;
      const end = control.selectionEnd ?? start;
      return { start, end: Math.max(start, end) };
    } catch {
      const length = control.value.length;
      return { start: length, end: length };
    }
  }

  private captureLiveRange(): Range | null {
    const doc = this.element.ownerDocument;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!this.element.contains(range.commonAncestorContainer)) return null;
    return range.cloneRange();
  }

  private rangeAtEnd(): Range {
    const range = this.element.ownerDocument.createRange();
    range.selectNodeContents(this.element);
    range.collapse(false);
    return range;
  }

  private ensureRange(): Range {
    if (
      this.range &&
      this.element.isConnected &&
      this.element.contains(this.range.commonAncestorContainer)
    ) {
      return this.range;
    }
    this.range = this.rangeAtEnd();
    return this.range;
  }

  private applySelection(range: Range): boolean {
    const doc = this.element.ownerDocument;
    const selection = doc.getSelection();
    if (!selection) return false;
    try {
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch {
      return false;
    }
  }

  private insertIntoContentEditable(text: string): void {
    if (this.contentStrategy === "paste") {
      if (this.tryPaste(text)) {
        this.trackInsertion(text);
        return;
      }
      this.contentStrategy = "unknown";
    }

    if (this.contentStrategy === "unknown" && this.tryPaste(text)) {
      this.contentStrategy = "paste";
      this.trackInsertion(text);
      return;
    }

    if (this.contentStrategy !== "dom") {
      const verify = this.contentStrategy === "unknown";
      const inserted = this.tryExecCommand(text, verify);
      if (inserted) {
        this.contentStrategy = "exec";
        this.trackInsertion(text);
        return;
      }
      if (this.contentStrategy === "exec") {
        this.contentStrategy = "unknown";
      }
      if (this.tryPaste(text)) {
        this.contentStrategy = "paste";
        this.trackInsertion(text);
        return;
      }
    }

    const inserted = this.insertViaRange(text);
    if (!inserted) {
      throw new InsertionError(
        "BLOCKED",
        "The rich-text field rejected programmatic input. Try Direct Insert or another field.",
      );
    }
    this.contentStrategy = "dom";
    this.trackInsertion(text);
  }

  private tryExecCommand(text: string, verify: boolean): boolean {
    const doc = this.element.ownerDocument;
    if (typeof doc.execCommand !== "function") return false;
    if (!this.applySelection(this.ensureRange())) return false;

    const before = verify ? this.element.innerHTML : "";
    let result = false;
    try {
      result = doc.execCommand("insertText", false, text);
    } catch {
      return false;
    }
    if (!result) return false;

    if (verify && this.element.innerHTML === before) return false;

    this.range = this.captureLiveRange() ?? this.ensureRange();
    return true;
  }

  private tryPaste(text: string): boolean {
    if (!this.applySelection(this.ensureRange())) return false;
    const doc = this.element.ownerDocument;
    const before = this.element.innerHTML;
    try {
      if (doc.documentElement.dataset.typeflowBridge === "1") {
        this.element.dispatchEvent(
          new CustomEvent(PASTE_REQUEST_EVENT, { detail: text, bubbles: true }),
        );
      } else {
        const event = buildPasteEvent(doc, text);
        if (!event) return false;
        this.element.dispatchEvent(event);
      }
    } catch {
      return false;
    }
    if (this.element.innerHTML === before) return false;
    this.range = this.captureLiveRange() ?? this.ensureRange();
    return true;
  }

  private insertViaRange(text: string): boolean {
    const range = this.ensureRange();
    try {
      range.deleteContents();
    } catch {
      return false;
    }

    const doc = this.element.ownerDocument;
    const fragment = doc.createDocumentFragment();
    const lines = text.split("\n");
    let lastNode: Node | null = null;

    lines.forEach((line, index) => {
      if (index > 0) {
        const br = doc.createElement("br");
        fragment.appendChild(br);
        lastNode = br;
      }
      if (line.length > 0) {
        const textNode = doc.createTextNode(line);
        fragment.appendChild(textNode);
        lastNode = textNode;
      }
    });

    if (!lastNode) {
      lastNode = doc.createTextNode("");
      fragment.appendChild(lastNode);
    }

    try {
      range.insertNode(fragment);
    } catch {
      return false;
    }

    const after = doc.createRange();
    after.setStartAfter(lastNode);
    after.collapse(true);
    this.range = after;
    this.applySelection(after);
    fireInput(this.element, text);
    return true;
  }

  private trackInsertion(text: string): void {
    this.insertedSinceCheck += text.length;
    this.pendingText += text;
    if (this.insertedSinceCheck < 20) return;
    this.insertedSinceCheck = 0;
    const snapshot = this.element.innerHTML;
    if (snapshot !== this.lastSnapshot) {
      this.lastSnapshot = snapshot;
      this.pendingText = "";
      return;
    }
    if (this.tryPaste(this.pendingText)) {
      this.contentStrategy = "paste";
      this.pendingText = "";
      this.lastSnapshot = this.element.innerHTML;
      return;
    }
    throw new InsertionError(
      "BLOCKED",
      "The rich-text field stopped accepting programmatic input. This editor may only accept its own paste or keyboard handling.",
    );
  }
}
