import type { TargetKind } from "../shared/types";
import { truncate } from "./text-utils";

export function getDeepActiveElement(doc: Document = document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

export function parentAcrossShadow(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) return root.host;
  return null;
}

export function isVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const win = element.ownerDocument.defaultView;
  if (!win) return false;
  const style = win.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }
  return Number.parseFloat(style.opacity || "1") > 0;
}

function textOfLabel(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = element.ownerDocument;
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;
  }
  const id = element.getAttribute("id");
  if (id) {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
    const label = element.ownerDocument.querySelector(`label[for="${escaped}"]`);
    const labelText = label?.textContent?.replace(/\s+/g, " ").trim();
    if (labelText) return labelText;
  }
  const wrappingLabel = element.closest("label");
  const wrappingText = wrappingLabel?.textContent?.replace(/\s+/g, " ").trim();
  if (wrappingText) return wrappingText;
  return "";
}

export function describeElement(element: Element): { kind: TargetKind; label: string } {
  let kind: TargetKind = "contenteditable";
  let tag = "editable";

  if (element instanceof HTMLTextAreaElement) {
    kind = "textarea";
    tag = "textarea";
  } else if (element instanceof HTMLInputElement) {
    kind = "input";
    tag = `input:${element.type || "text"}`;
  }

  const parts: string[] = [];
  const aria = element.getAttribute("aria-label")?.trim();
  if (aria) parts.push(aria);
  const placeholder =
    element.getAttribute("placeholder")?.trim() ||
    element.getAttribute("data-placeholder")?.trim();
  if (placeholder) parts.push(placeholder);
  const label = textOfLabel(element);
  if (label && label !== placeholder) parts.push(label);
  const name = element.getAttribute("name")?.trim();
  if (name) parts.push(`[name="${name}"]`);
  const id = element.getAttribute("id")?.trim();
  if (id && !label) parts.push(`#${id}`);

  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  const suffix = unique.length > 0 ? ` — ${unique.join(" · ")}` : "";
  return { kind, label: truncate(`${tag}${suffix}`, 80) };
}
