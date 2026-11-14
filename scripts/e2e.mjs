import { chromium } from "playwright-core";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const ckeditorBuild = path.join(
  root,
  "node_modules",
  "@ckeditor",
  "ckeditor5-build-classic",
  "build",
  "ckeditor.js",
);
const chromePath =
  process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
    ? process.env.CHROME_PATH
    : null;

const HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>TypeFlow test page</title></head>
  <body>
    <h1>TypeFlow test page</h1>
    <textarea id="t" placeholder="Comment"></textarea>
    <input id="inp" type="text" value="" />
    <div id="ce" contenteditable="true" data-placeholder="Rich text"></div>
    <div id="editor" contenteditable="true" role="textbox" aria-multiline="true">
      <p>Hello</p>
    </div>
    <div id="dynamic-host"></div>
    <div id="shadow-host"></div>
    <div id="paste-editor" contenteditable="true" style="min-height:80px;border:1px solid #999"></div>
    <script>
      window.inputEvents = 0;
      document.getElementById('t').addEventListener('input', () => {
        window.inputEvents += 1;
      });
      window.richInputs = 0;
      document.getElementById('editor').addEventListener('input', () => {
        window.richInputs += 1;
      });
      window.addDynamicField = () => {
        const field = document.createElement('textarea');
        field.id = 'dyn';
        field.value = '';
        document.getElementById('dynamic-host').append(field);
        field.focus();
      };
      window.addEditorFrame = () => {
        const frame = document.createElement('iframe');
        frame.id = 'editor-frame';
        frame.style.cssText = 'width:420px;height:120px';
        frame.srcdoc = '<!doctype html><html><body><div id="frame-editor" contenteditable="true" style="min-height:80px;border:1px solid #999"></div></body></html>';
        document.body.append(frame);
      };
      const shadow = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div id="shadow-editor" contenteditable="true" style="min-height:80px;border:1px solid #999"></div>';

      const pasteEditor = document.getElementById('paste-editor');
      pasteEditor.addEventListener('beforeinput', (event) => event.preventDefault());
      pasteEditor.addEventListener('paste', (event) => {
        event.preventDefault();
        pasteEditor.textContent += event.clipboardData?.getData('text/plain') ?? '';
      });
    </script>
  </body>
</html>`;

const FRAME_HTML = `<!doctype html>
<html><body><div id="external-editor" contenteditable="true" style="min-height:80px;border:1px solid #999"></div></body></html>`;

const CROSS_ORIGIN_HTML = `<!doctype html>
<html><body>
  <p>Cross-origin editor test</p>
  <script>
    const frame = document.createElement('iframe');
    frame.id = 'external-editor-frame';
    frame.src = 'http://editor.test:' + location.port + '/frame';
    frame.style.cssText = 'width:420px;height:120px';
    document.body.append(frame);
  </script>
</body></html>`;

const CKEDITOR_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>CKEditor 5 test page</title></head>
  <body>
    <h1>CKEditor 5 test page</h1>
    <div id="cke"></div>
    <script src="/ckeditor.js"></script>
    <script>
      window.ckeReady = ClassicEditor.create(document.getElementById('cke'))
        .then((editor) => {
          window.ckeEditor = editor;
          editor.editing.view.focus();
          return true;
        })
        .catch((error) => {
          window.ckeError = String(error);
          return false;
        });
    </script>
  </body>
</html>`;

async function startServer() {
  const server = createServer((request, response) => {
    if (request.url === "/ckeditor.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      createReadStream(ckeditorBuild).pipe(response);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/frame") {
      response.end(FRAME_HTML);
    } else if (request.url === "/cross-origin") {
      response.end(CROSS_ORIGIN_HTML);
    } else if (request.url === "/cke") {
      response.end(CKEDITOR_HTML);
    } else {
      response.end(HTML);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function prepareExtension() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "typeflow-e2e-"));
  const extensionDir = path.join(tempRoot, "extension");
  await cp(dist, extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { tempRoot, extensionDir };
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
  }
  const url = new URL(worker.url());
  return url.host;
}

function pretty(step) {
  console.log(`\n▶ ${step}`);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
}

async function openPopup(context, extensionId, targetPage, focus, expectTarget = true) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await targetPage.bringToFront();
  if (typeof focus === "string") {
    await targetPage.locator(focus).focus();
  } else {
    await focus();
  }
  await page.reload();
  if (expectTarget) {
    await page.waitForFunction(
      () => {
        const line = document.querySelector("#target-line");
        return !!line && !line.textContent.includes("No editable");
      },
      undefined,
      { timeout: 15000 },
    );
  } else {
    await page.locator("#target-line").waitFor({ state: "attached" });
  }
  return page;
}

async function setMethod(popup, method) {
  await popup.locator(`[data-method="${method}"]`).click();
}

async function setFastTyping(popup, delay = 1) {
  if (await popup.locator("#settings-body").isHidden()) {
    await popup.locator("#settings-toggle").click();
  }
  await popup.locator('[data-speed="custom"]').click();
  for (const [selector, value] of [
    ["#min-delay", String(delay)],
    ["#max-delay", String(delay)],
    ["#paragraph-pause", "0"],
    ["#start-delay", "0"],
  ]) {
    await popup.locator(selector).fill(value);
    await popup.locator(selector).dispatchEvent("change");
  }
}

async function fillTextAndStart(popup, text) {
  await popup.locator("#editor").fill(text);
  await popup.waitForFunction(
    () => !document.querySelector("#start-btn").disabled,
    undefined,
    { timeout: 10000 },
  );
  await popup.locator("#start-btn").click();
}

async function readProgress(popup) {
  return popup.evaluate(() => ({
    pill: document.querySelector("#status-pill")?.textContent?.trim(),
    chars: document.querySelector("#progress-chars")?.textContent?.trim(),
    total: document.querySelector("#progress-total")?.textContent?.trim(),
    percent: document.querySelector("#progress-percent")?.textContent?.trim(),
    status: document.querySelector("#status-text")?.textContent?.trim(),
  }));
}

async function waitForTextarea(targetPage, expected, timeout = 30000) {
  await targetPage.waitForFunction(
    (value) => document.querySelector("#t")?.value === value,
    expected,
    { timeout },
  );
}

async function waitForProgress(popup, predicateSource, timeout = 30000) {
  await popup.waitForFunction(
    (source) => {
      const pill = document.querySelector("#status-pill")?.textContent?.trim();
      const chars = Number(
        (document.querySelector("#progress-chars")?.textContent ?? "0").replace(/,/g, ""),
      );
      const total = Number(
        (document.querySelector("#progress-total")?.textContent ?? "0").replace(/,/g, ""),
      );
      if (source === "completed") return pill === "Completed";
      if (source === "paused") return pill === "Paused";
      if (source === "stopped") return pill === "Stopped";
      if (source === "started") return chars >= 2;
      return false;
    },
    predicateSource,
    { timeout },
  );
}

async function main() {
  const { server, url } = await startServer();
  const { tempRoot, extensionDir } = await prepareExtension();
  const userDataDir = path.join(tempRoot, "profile");
  const headless = process.env.HEADFUL !== "1";
  let context;

  try {
    pretty(`Launching Chrome (${headless ? "headless" : "headed"})`);
    context = await chromium.launchPersistentContext(userDataDir, {
      ...(chromePath ? { executablePath: chromePath } : { channel: "chromium" }),
      headless,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-component-update",
        "--host-resolver-rules=MAP editor.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ],
      viewport: { width: 1280, height: 900 },
    });

    const extensionId = await getExtensionId(context);
    pass(`Extension loaded: ${extensionId}`);

    const targetPage = context.pages()[0] ?? (await context.newPage());
    await targetPage.goto(url);
    pass("Test page ready");

    pretty("Direct insertion into an empty textarea");
    let popup = await openPopup(context, extensionId, targetPage, "#t");
    await popup.bringToFront();
    await setMethod(popup, "direct");
    const directText = "Halo, dunia!\nBaris kedua — tést ✓";
    await fillTextAndStart(popup, directText);
    await waitForTextarea(targetPage, directText);
    const inputEvents = await targetPage.evaluate(() => window.inputEvents ?? 0);
    assert.ok(inputEvents >= 1, "input event should be dispatched");
    let progress = await readProgress(popup);
    assert.equal(progress.pill, "Completed");
    pass("Direct insert set the value and dispatched an input event");
    await popup.close();

    pretty("Direct insertion preserves existing text at the cursor");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const t = document.querySelector("#t");
      t.value = "Hello world";
      t.focus();
      t.setSelectionRange(5, 5);
    });
    popup = await openPopup(context, extensionId, targetPage, "#t");
    await targetPage.evaluate(() => {
      const t = document.querySelector("#t");
      t.focus();
      t.setSelectionRange(5, 5);
    });
    await popup.bringToFront();
    await setMethod(popup, "direct");
    await fillTextAndStart(popup, " brave");
    await waitForTextarea(targetPage, "Hello brave world");
    pass("Cursor position respected, surrounding content preserved");
    await popup.close();

    pretty("Direct insertion into a single-line input field");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const input = document.querySelector("#inp");
      input.value = "";
      input.focus();
      input.setSelectionRange(0, 0);
    });
    popup = await openPopup(context, extensionId, targetPage, "#inp");
    await popup.bringToFront();
    await setMethod(popup, "direct");
    await fillTextAndStart(popup, "Input works ✓");
    await targetPage.waitForFunction(
      () => document.querySelector("#inp")?.value === "Input works ✓",
      undefined,
      { timeout: 10000 },
    );
    pass("Text input value inserted");
    await popup.close();

    pretty("Direct insertion into a paragraph-based rich-text editor");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const editor = document.querySelector("#editor");
      editor.innerHTML = "<p>Hello</p>";
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.richInputs = 0;
    });
    popup = await openPopup(context, extensionId, targetPage, "#editor");
    await targetPage.evaluate(() => {
      const editor = document.querySelector("#editor");
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await popup.bringToFront();
    await setMethod(popup, "direct");
    await fillTextAndStart(popup, " brave world 🌍");
    await targetPage.waitForFunction(
      () => (document.querySelector("#editor")?.textContent ?? "").includes("brave world 🌍"),
      undefined,
      { timeout: 10000 },
    );
    const richResult = await targetPage.evaluate(() => ({
      text: document.querySelector("#editor")?.textContent?.trim(),
      events: window.richInputs,
    }));
    assert.match(richResult.text ?? "", /Hello\s+brave world 🌍/);
    assert.ok(richResult.events >= 1, "rich text editor should receive input events");
    pass("Rich-text paragraphs preserved and input events dispatched");
    await popup.close();

    pretty("Direct insertion into an editor that only accepts paste events");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const editor = document.querySelector("#paste-editor");
      editor.textContent = "";
      editor.focus();
    });
    popup = await openPopup(context, extensionId, targetPage, "#paste-editor");
    await popup.bringToFront();
    await setMethod(popup, "direct");
    const pasteOnlyText = "paste-only editor fallback 12345";
    await fillTextAndStart(popup, pasteOnlyText);
    await targetPage.waitForFunction(
      (expected) => document.querySelector("#paste-editor")?.textContent === expected,
      pasteOnlyText,
      { timeout: 10000 },
    );
    const pasteOnlyProgress = await readProgress(popup);
    assert.equal(pasteOnlyProgress.pill, "Completed");
    pass("Synthetic paste fallback inserted text");
    await popup.close();

    pretty("Direct insertion into a CKEditor 5 rich-text editor");
    const ckePage = await context.newPage();
    await ckePage.goto(`${url}cke`);
    await ckePage.waitForFunction(() => window.ckeEditor || window.ckeError, undefined, {
      timeout: 20000,
    });
    const ckeError = await ckePage.evaluate(() => window.ckeError ?? null);
    assert.equal(ckeError, null, "CKEditor should initialize");
    popup = await openPopup(context, extensionId, ckePage, () =>
      ckePage.evaluate(() => window.ckeEditor.editing.view.focus()),
    );
    await popup.bringToFront();
    await setMethod(popup, "direct");
    const ckeText = "Halo CKEditor\n\nBaris kedua — tes ✓";
    await fillTextAndStart(popup, ckeText);
    await ckePage.waitForFunction(
      () => (window.ckeEditor?.getData() ?? "").includes("Baris kedua — tes ✓"),
      undefined,
      { timeout: 15000 },
    );
    const ckeData = await ckePage.evaluate(() => window.ckeEditor.getData());
    assert.match(ckeData, /Halo CKEditor/);
    assert.match(ckeData, /Baris kedua — tes ✓/);
    const ckeProgress = await readProgress(popup);
    assert.equal(ckeProgress.pill, "Completed");
    pass("CKEditor 5 model accepted the inserted text");
    await popup.close();
    await ckePage.close();

    pretty("Direct insertion into a dynamically added field");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => window.addDynamicField());
    await targetPage.locator("#dyn").waitFor({ state: "visible" });
    popup = await openPopup(context, extensionId, targetPage, "#dyn");
    await popup.bringToFront();
    await setMethod(popup, "direct");
    await fillTextAndStart(popup, "dynamic field ok");
    await targetPage.waitForFunction(
      () => document.querySelector("#dyn")?.value === "dynamic field ok",
      undefined,
      { timeout: 10000 },
    );
    pass("Dynamically added textarea targeted and filled");
    await popup.close();

    pretty("Direct insertion into an editor inside an open shadow root");
    await targetPage.bringToFront();
    popup = await openPopup(context, extensionId, targetPage, () =>
      targetPage.evaluate(() => {
        const shadow = document.querySelector("#shadow-host")?.shadowRoot;
        const editor = shadow?.querySelector("#shadow-editor");
        if (!(editor instanceof HTMLElement)) throw new Error("Missing shadow editor");
        editor.focus();
      }),
    );
    await popup.bringToFront();
    await setMethod(popup, "direct");
    await fillTextAndStart(popup, "shadow editor ok");
    await targetPage.waitForFunction(
      () =>
        (
          document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-editor")
            ?.textContent ?? ""
        ).includes("shadow editor ok"),
      undefined,
      { timeout: 10000 },
    );
    pass("Shadow-root editor discovered and filled");
    await popup.close();

    pretty("Direct insertion into an iframe editor created after injection");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => window.addEditorFrame());
    const editorFrame = targetPage.frameLocator("#editor-frame");
    await editorFrame.locator("#frame-editor").waitFor({ state: "visible" });
    popup = await openPopup(context, extensionId, targetPage, () =>
      editorFrame.locator("#frame-editor").focus(),
    );
    await popup.bringToFront();
    await setMethod(popup, "direct");
    await fillTextAndStart(popup, "iframe editor ok");
    await targetPage.waitForFunction(
      () =>
        (
          document.querySelector("#editor-frame")?.contentDocument?.querySelector("#frame-editor")
            ?.textContent ?? ""
        ).includes("iframe editor ok"),
      undefined,
      { timeout: 10000 },
    );
    pass("Late same-origin iframe editor discovered and filled");
    await popup.close();

    pretty("Cross-origin iframe editor detection and site-access offer");
    const crossOriginPage = await context.newPage();
    await crossOriginPage.goto(`${url}cross-origin`);
    const externalFrame = crossOriginPage.frameLocator("#external-editor-frame");
    await externalFrame.locator("#external-editor").waitFor({ state: "visible" });
    popup = await openPopup(
      context,
      extensionId,
      crossOriginPage,
      () => externalFrame.locator("#external-editor").focus(),
      false,
    );
    await popup.bringToFront();
    await popup.waitForFunction(() => !document.querySelector("#site-access-btn")?.hidden, undefined, {
      timeout: 15000,
    });
    const crossOriginText = (await popup.locator("#target-line").textContent()) ?? "";
    const crossOriginNotice = (await popup.locator("#status-text").textContent()) ?? "";
    assert.match(crossOriginText, /No editable field/i);
    assert.match(crossOriginNotice, /embedded frame/i);
    assert.match(crossOriginNotice, /editor\.test/);
    pass("Cross-origin editor reported and Allow editor site offered");
    await popup.close();
    await crossOriginPage.close();
    await targetPage.bringToFront();

    pretty("Typing simulation into a contenteditable field");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      document.querySelector("#ce").innerHTML = "";
      document.querySelector("#t").value = "";
    });
    popup = await openPopup(context, extensionId, targetPage, "#ce");
    await popup.bringToFront();
    await setMethod(popup, "typing");
    await setFastTyping(popup, 1);
    const richText = "Halo 🌅\nDunia";
    await fillTextAndStart(popup, richText);
    await targetPage.waitForFunction(
      () => {
        const text = document.querySelector("#ce")?.textContent ?? "";
        return text.includes("Halo") && text.includes("Dunia");
      },
      undefined,
      { timeout: 30000 },
    );
    const richHtml = await targetPage.evaluate(() => document.querySelector("#ce")?.innerHTML);
    assert.match(richHtml, /br|div|<p/i, "paragraph break should be represented");
    await waitForProgress(popup, "completed");
    progress = await readProgress(popup);
    assert.equal(progress.chars, progress.total);
    pass("Unicode, spaces and paragraph breaks preserved in contenteditable");
    await popup.close();

    pretty("Pause and resume during typing");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const t = document.querySelector("#t");
      t.value = "";
      t.focus();
      t.setSelectionRange(0, 0);
    });
    popup = await openPopup(context, extensionId, targetPage, "#t");
    await popup.bringToFront();
    await setMethod(popup, "typing");
    await setFastTyping(popup, 25);
    const pausedText = "abcdefghijklmnopqrst";
    await fillTextAndStart(popup, pausedText);
    await waitForProgress(popup, "started");
    await popup.locator("#pause-btn").click();
    await waitForProgress(popup, "paused");
    const frozenValue = await targetPage.evaluate(() => document.querySelector("#t")?.value ?? "");
    await targetPage.waitForTimeout(400);
    const stillFrozen = await targetPage.evaluate(() => document.querySelector("#t")?.value ?? "");
    assert.equal(stillFrozen, frozenValue, "typing should stop while paused");
    await popup.locator("#pause-btn").click();
    await waitForTextarea(targetPage, pausedText);
    pass(`Paused at ${frozenValue.length} chars, resumed to completion`);
    await popup.close();

    pretty("Immediate stop during typing");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const t = document.querySelector("#t");
      t.value = "";
      t.focus();
      t.setSelectionRange(0, 0);
    });
    popup = await openPopup(context, extensionId, targetPage, "#t");
    await popup.bringToFront();
    await setMethod(popup, "typing");
    await setFastTyping(popup, 40);
    const stoppedText = "abcdefghijklmnopqrstuvwxyz0123456789";
    await fillTextAndStart(popup, stoppedText);
    await waitForProgress(popup, "started");
    await popup.locator("#stop-btn").click();
    await waitForProgress(popup, "stopped");
    const stoppedValue = await targetPage.evaluate(() => document.querySelector("#t")?.value ?? "");
    await targetPage.waitForTimeout(400);
    const afterStop = await targetPage.evaluate(() => document.querySelector("#t")?.value ?? "");
    assert.equal(afterStop, stoppedValue, "typing should not continue after stop");
    assert.ok(stoppedValue.length > 0 && stoppedValue.length < stoppedText.length);
    progress = await readProgress(popup);
    assert.notEqual(progress.percent, "100%");
    pass(`Stopped at ${stoppedValue.length} chars and kept progress`);
    await popup.close();

    pretty("Closing the popup does not stop typing; reopening restores progress");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const t = document.querySelector("#t");
      t.value = "";
      t.focus();
      t.setSelectionRange(0, 0);
    });
    popup = await openPopup(context, extensionId, targetPage, "#t");
    await popup.bringToFront();
    await setMethod(popup, "typing");
    await setFastTyping(popup, 6);
    const longText = "TypeFlow continues typing while the popup is closed. ".repeat(3).trim();
    await fillTextAndStart(popup, longText);
    await waitForProgress(popup, "started");
    const otherTab = await context.newPage();
    await otherTab.goto("about:blank");
    await otherTab.bringToFront();
    pass("Switched to another tab while typing");
    await popup.close();
    pass("Popup closed mid-run");
    await waitForTextarea(targetPage, longText, 60000);
    pass("Content script finished without the popup");
    await otherTab.close();

    await targetPage.bringToFront();
    await targetPage.locator("#t").focus();
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await targetPage.bringToFront();
    await reopened.reload();
    await reopened.waitForFunction(
      () => document.querySelector("#status-pill")?.textContent?.trim() === "Completed",
      undefined,
      { timeout: 15000 },
    );
    progress = await readProgress(reopened);
    assert.equal(progress.chars, progress.total);
    assert.ok(Number(progress.percent?.replace("%", "")) === 100);
    pass("Reopened popup recovered completed progress state");
    await reopened.close();

    pretty("Long text (10,000+ characters) direct insertion");
    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      const t = document.querySelector("#t");
      t.value = "";
      t.focus();
      t.setSelectionRange(0, 0);
    });
    popup = await openPopup(context, extensionId, targetPage, "#t");
    await popup.bringToFront();
    await setMethod(popup, "direct");
    const longDirect = "Baris panjang 0123456789 — unicode ✓ 🌅. ".repeat(260);
    await fillTextAndStart(popup, longDirect);
    await targetPage.waitForFunction(
      (expected) => document.querySelector("#t")?.value === expected,
      longDirect,
      { timeout: 20000 },
    );
    const lengths = await targetPage.evaluate(() => ({
      length: document.querySelector("#t")?.value.length ?? 0,
    }));
    assert.ok(lengths.length > 10000);
    pass(`Inserted ${lengths.length} characters directly`);
    await popup.close();

    console.log("\nAll E2E checks passed.");
  } finally {
    if (context) await context.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
