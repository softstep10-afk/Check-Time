// End-to-end verification of the two reported regressions:
//   (1) worker task modal opens on click
//   (2) project media preview never sticks on Loading
// Run after restarting `next dev`. Diagnostic-only — not part of the build.

import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import WebSocket from "ws";

const profile = mkdtempSync(join(tmpdir(), "ct-verify-"));
const PORT = 9231;

const child = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore", detached: true },
);
child.unref();
await wait(2500);

const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const target = tabs.find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.error ? reject(m.error) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
await new Promise((r) => ws.once("open", r));
await send("Page.enable");
await send("Runtime.enable");

async function evaluate(expr, awaitPromise = false) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise,
  });
  return r.result.value;
}

async function probe(label, url, steps) {
  console.log(`\n== ${label}: ${url} ==`);
  await send("Page.navigate", { url });
  await wait(8000);
  for (const [name, expr, isAsync] of steps) {
    const value = await evaluate(expr, isAsync);
    console.log(`${name}:`, JSON.stringify(value).slice(0, 400));
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`scripts/${label}.png`, Buffer.from(shot.data, "base64"));
}

// ── Test 1: /my-tasks ─────────────────────────────────────────
await probe("verify-tasks", "http://127.0.0.1:3000/my-tasks", [
  [
    "before",
    `(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(
        (b) => b.textContent.trim().includes('Открыть детали'),
      );
      return JSON.stringify({
        btnFound: btns.length,
        hasReactProps:
          btns[0] &&
          Object.getOwnPropertyNames(btns[0]).some((k) =>
            k.startsWith('__reactProps'),
          ),
        modalOpen: document.body.textContent.includes('Детали задачи'),
      });
    })()`,
  ],
  [
    "click",
    `(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(
        (b) => b.textContent.trim().includes('Открыть детали'),
      );
      btns[0]?.click();
      return btns[0] ? "clicked" : "no button";
    })()`,
  ],
  [
    "after_click",
    `(async () => {
      await new Promise((r) => setTimeout(r, 700));
      const fixedHigh = Array.from(document.querySelectorAll('div'))
        .filter((d) => {
          const cs = window.getComputedStyle(d);
          return cs.position === 'fixed' && Number(cs.zIndex) >= 100;
        })
        .map((d) => ({
          z: window.getComputedStyle(d).zIndex,
          firstText: (d.textContent || '').slice(0, 60),
        }));
      return JSON.stringify({
        modalOpen: document.body.textContent.includes('Детали задачи'),
        fixedHigh,
      });
    })()`,
    true,
  ],
]);

// ── Test 2: /projects/...22 video Open ────────────────────────
await probe(
  "verify-media",
  "http://127.0.0.1:3000/projects/00000000-0000-0000-0000-000000000022",
  [
    [
      "before",
      `(() => {
        // Scroll to the media area first so the Open button is in view.
        const headers = Array.from(document.querySelectorAll('h2'));
        const recent = headers.find((h) => h.textContent.includes('медиа') || h.textContent.includes('Recent') || h.textContent.includes('Media'));
        recent?.scrollIntoView({ behavior: 'instant', block: 'start' });
        return JSON.stringify({
          buttonsContainingOpen: Array.from(document.querySelectorAll('button'))
            .map((b) => b.textContent.trim().slice(0, 25))
            .filter((t) => t.includes('Открыть') || t.includes('Open'))
            .slice(0, 10),
        });
      })()`,
    ],
    [
      "click_open",
      `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        // Match the file-open button (not "Открыть проект").
        const open = buttons.find(
          (b) => /^\\s*Открыть файл\\s*$/.test(b.textContent || '') ||
                 /^\\s*Open file\\s*$/.test(b.textContent || ''),
        );
        if (!open) return "no Open file button";
        open.click();
        return "clicked";
      })()`,
    ],
    [
      "after_open",
      `(async () => {
        // 11s wait covers the 9s sign timeout plus a render tick.
        await new Promise((r) => setTimeout(r, 11000));
        const text = document.body.textContent;
        const overlay =
          Array.from(document.querySelectorAll('div')).filter((d) => {
            const cs = window.getComputedStyle(d);
            return cs.position === 'fixed' && Number(cs.zIndex) >= 100;
          }).length;
        return JSON.stringify({
          previewModalPresent:
            text.includes('Playback') ||
            !!document.querySelector('video, img[alt]'),
          loadingStillVisible: text.includes('Loading') || text.includes('Загрузка'),
          errorPresent:
            text.includes('Preview timed out') ||
            text.includes('истекло') ||
            text.includes("Couldn't"),
          fixedOverlayCount: overlay,
        });
      })()`,
      true,
    ],
  ],
);

ws.close();
process.exit(0);
