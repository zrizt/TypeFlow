import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.com/form",
  pretendToBeVisual: true,
});

const globals = globalThis as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;
globals.Node = dom.window.Node;
globals.Element = dom.window.Element;
globals.HTMLElement = dom.window.HTMLElement;
globals.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
globals.HTMLInputElement = dom.window.HTMLInputElement;
globals.InputEvent = dom.window.InputEvent;
globals.Event = dom.window.Event;
globals.ShadowRoot = dom.window.ShadowRoot;
globals.CSS = dom.window.CSS;
globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globals.MutationObserver = dom.window.MutationObserver;

const { FieldAdapter, InsertionError } = await import("../src/content/insertion.ts");

function mount<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  return element;
}

test("inserts text into a textarea at the cursor position", () => {
  const textarea = mount(document.createElement("textarea"));
  textarea.value = "Hello world";
  textarea.setSelectionRange(5, 5);

  const events: InputEvent[] = [];
  textarea.addEventListener("input", (event) => events.push(event as InputEvent));

  const adapter = new FieldAdapter(textarea);
  const inserted = adapter.insertText(" brave");

  assert.equal(inserted, 6);
  assert.equal(textarea.value, "Hello brave world");
  assert.equal(textarea.selectionStart, 11);
  assert.equal(textarea.selectionEnd, 11);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.inputType, "insertText");
  assert.equal(events[0]?.data, " brave");
});

test("replaces the selected range and preserves surrounding content", () => {
  const textarea = mount(document.createElement("textarea"));
  textarea.value = "abcdef";
  textarea.setSelectionRange(2, 4);

  const adapter = new FieldAdapter(textarea);
  adapter.insertText("XY");

  assert.equal(textarea.value, "abXYef");
});

test("normalizes CRLF when inserting into a textarea", () => {
  const textarea = mount(document.createElement("textarea"));
  textarea.value = "start";

  const adapter = new FieldAdapter(textarea);
  adapter.insertText("\r\nbaris dua");

  assert.equal(textarea.value, "start\nbaris dua");
});

test("appends text to input types without selection support", () => {
  const input = mount(document.createElement("input"));
  input.type = "email";
  input.value = "halo@example.com";

  const adapter = new FieldAdapter(input);
  adapter.insertText("!");

  assert.equal(input.value, "halo@example.com!");
});

test("respects a cancelled beforeinput event", () => {
  const textarea = mount(document.createElement("textarea"));
  textarea.value = "";
  textarea.addEventListener("beforeinput", (event) => event.preventDefault());

  const adapter = new FieldAdapter(textarea);
  assert.throws(
    () => adapter.insertText("blocked"),
    (error: unknown) =>
      error instanceof InsertionError && error.code === "BLOCKED",
  );
  assert.equal(textarea.value, "");
});

test("works when the page blocks paste events", () => {
  const textarea = mount(document.createElement("textarea"));
  textarea.value = "";
  textarea.addEventListener("paste", (event) => event.preventDefault());

  const adapter = new FieldAdapter(textarea);
  adapter.insertText("paste-blocked site");

  assert.equal(textarea.value, "paste-blocked site");
});

test("bypasses instance-level value setters used by controlled frameworks", () => {
  const textarea = mount(document.createElement("textarea"));
  textarea.value = "ab";
  textarea.setSelectionRange(2, 2);

  let instanceSetterCalls = 0;
  Object.defineProperty(textarea, "value", {
    configurable: true,
    get() {
      return Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.get?.call(this) as string;
    },
    set(nextValue: string) {
      instanceSetterCalls += 1;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(this, nextValue);
    },
  });

  const adapter = new FieldAdapter(textarea);
  adapter.insertText("c");

  assert.equal(instanceSetterCalls, 0);
  assert.equal(textarea.value, "abc");
});

test("supports contenteditable elements through the DOM fallback", () => {
  const editor = mount(document.createElement("div"));
  editor.setAttribute("contenteditable", "true");
  const textNode = document.createTextNode("Hello");
  editor.append(textNode);

  const range = document.createRange();
  range.selectNodeContents(textNode);
  range.collapse(false);
  const selection = document.getSelection();
  assert.ok(selection);
  selection.removeAllRanges();
  selection.addRange(range);

  const events: Event[] = [];
  editor.addEventListener("input", (event) => events.push(event));

  const adapter = new FieldAdapter(editor);
  adapter.insertText("\nWorld");

  assert.equal(editor.querySelectorAll("br").length, 1);
  assert.match(editor.textContent ?? "", /HelloWorld/);
  assert.equal(events.length, 1);
});

test("rejects read-only and disabled fields", () => {
  const readOnly = mount(document.createElement("textarea"));
  readOnly.readOnly = true;
  assert.throws(
    () => new FieldAdapter(readOnly),
    (error: unknown) => error instanceof InsertionError && error.code === "NO_TARGET",
  );

  const disabled = mount(document.createElement("textarea"));
  disabled.disabled = true;
  assert.throws(
    () => new FieldAdapter(disabled),
    (error: unknown) => error instanceof InsertionError && error.code === "NO_TARGET",
  );
});

test("detects when the target is detached from the document", () => {
  const textarea = mount(document.createElement("textarea"));
  textarea.value = "";
  const adapter = new FieldAdapter(textarea);
  textarea.remove();
  assert.equal(adapter.isAlive(), false);
  assert.throws(
    () => adapter.insertText("x"),
    (error: unknown) => error instanceof InsertionError && error.code === "TARGET_GONE",
  );
});
