import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import WebSocket from "ws";

const profile = mkdtempSync(join(tmpdir(), "ct-d2-"));
const PORT = 9230;

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
const consoleEvents = [];
const exceptions = [];
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    consoleEvents.push(
      `[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? "<obj>").join(" ").slice(0, 300)}`,
    );
  } else if (msg.method === "Runtime.exceptionThrown") {
    exceptions.push(
      msg.params.exceptionDetails.text + ": " +
      (msg.params.exceptionDetails.exception?.description || "").slice(0, 600),
    );
  }
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(msg.error) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
await new Promise((r) => ws.once("open", r));
await send("Page.enable");
await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__diagErrors = [];
    const origError = console.error;
    console.error = function(...args) {
      try {
        window.__diagErrors.push(args.map((a) => {
          if (a instanceof Error) return a.message + " | " + (a.stack || "").slice(0, 600);
          if (typeof a === "string") return a.slice(0, 600);
          try { return JSON.stringify(a).slice(0, 600); } catch { return String(a).slice(0, 200); }
        }).join(" "));
      } catch {}
      return origError.apply(this, args);
    };
  `,
});

// Capture EVERYTHING during navigation: all logs, all errors, all
// network failures.
const logs = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Log.entryAdded") {
    logs.push(`[${m.params.entry.level}] ${m.params.entry.text.slice(0, 400)}`);
  }
});
await send("Log.enable");
await send("Network.enable");

// Capture script execution errors from Debugger.scriptFailedToParse
// and Debugger.paused with reason=exception.
await send("Debugger.enable");
const debuggerEvents = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Debugger.scriptFailedToParse") {
    debuggerEvents.push(`PARSE_FAIL: ${m.params.url} @${m.params.lineNumber}: ${m.params.errorMessage || "?"}`);
  }
});

await send("Page.navigate", { url: "http://127.0.0.1:3000/my-tasks" });
await wait(12000);

console.log("\n== DEBUGGER EVENTS ==");
console.log(debuggerEvents.join("\n"));

console.log("\n== Log.entryAdded EVENTS ==");
console.log(logs.slice(-20).join("\n"));

const state = await send("Runtime.evaluate", {
  expression: `JSON.stringify({
    bodyOwnKeys: Object.getOwnPropertyNames(document.body),
    htmlOwnKeys: Object.getOwnPropertyNames(document.documentElement),
    rootDivKeys: (() => {
      const root = document.querySelector('div.min-h-screen');
      return root ? Object.getOwnPropertyNames(root) : [];
    })(),
    bodyTextLen: document.body.textContent.length,
    hasOpenDetalils: document.body.textContent.includes('Открыть детали'),
    capturedErrors: window.__diagErrors || [],
  })`,
  returnByValue: true,
});
console.log("STATE:", state.result.value);

console.log("\n== CONSOLE EVENTS ==");
console.log(consoleEvents.slice(-15).join("\n"));
console.log("\n== EXCEPTIONS ==");
console.log(exceptions.join("\n"));

ws.close();
process.exit(0);
