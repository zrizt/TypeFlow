(() => {
  const FLAG = "__typeflowPasteBridge";
  const REQUEST = "typeflow:paste";
  const guardedWindow = window as Window & { [FLAG]?: boolean };
  if (guardedWindow[FLAG]) return;
  guardedWindow[FLAG] = true;
  document.documentElement.dataset.typeflowBridge = "1";

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toHtml(text: string): string {
    return text
      .split(/\r?\n\r?\n/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`)
      .join("");
  }

  document.addEventListener(
    REQUEST,
    (request) => {
      const target = request.target;
      if (!(target instanceof HTMLElement)) return;
      const text = (request as CustomEvent<unknown>).detail;
      if (typeof text !== "string" || !text) return;
      try {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        data.setData("text/html", toHtml(text));
        const event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        });
        target.dispatchEvent(event);
      } catch {
        /* The page may be in a state where clipboard events cannot be created. */
      }
    },
    true,
  );
})();
