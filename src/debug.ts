/**
 * Temporary on-screen debug logger, used while tracking down the "Add to scene"
 * issue. Owlbear's extension iframe is cross-origin from the room page, and
 * Firefox's DevTools console (even via "Inspect Element") wasn't reliably
 * surfacing its console.log output - writing the same messages directly into the
 * page sidesteps that devtools/iframe targeting problem entirely, since there's
 * nothing left to misconfigure: if the code runs, the message is on screen.
 *
 * Safe to remove once debugging is done (or leave in - it's inert until
 * debugLog() is actually called).
 */

function panel(): HTMLDivElement {
  let el = document.getElementById("mou-debug-panel") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "mou-debug-panel";
    el.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;max-height:35vh;overflow-y:auto;" +
      "background:rgba(10,10,10,0.92);color:#7CFC7C;font:11px/1.4 monospace;" +
      "padding:6px 10px;z-index:99999;white-space:pre-wrap;word-break:break-word;" +
      "border-top:2px solid #7CFC7C;";
    document.body.appendChild(el);
  }
  return el;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * `String(someError)` / plain `JSON.stringify(someError)` often collapse down to
 * a useless "[object Object]" or "{}": Error's own properties (message, stack,
 * name) are non-enumerable (so plain JSON.stringify drops them), and some
 * rejections (e.g. DOMException, or whatever the OBR SDK's message bus rejects
 * with) define message/name/code as *getters on the prototype* rather than as
 * the instance's own properties, so even walking `Object.getOwnPropertyNames`
 * finds nothing. This probes those well-known fields by name regardless of where
 * they actually live, and recurses into nested objects the same way (a naive
 * `JSON.stringify(e, someKeyWhitelist)` applies that whitelist at every nesting
 * level too, which silently empties out nested objects - a first attempt at this
 * hit exactly that and printed `{"error":{}}` with the real detail missing).
 */
function toPlain(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return "[too deep]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => toPlain(v, seen, depth + 1));

  const out: Record<string, unknown> = {};
  for (const key of ["message", "name", "code", "reason", "status", "stack"]) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = toPlain(v, seen, depth + 1);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key in out) continue;
    try {
      out[key] = toPlain((value as Record<string, unknown>)[key], seen, depth + 1);
    } catch {
      out[key] = "[unreadable]";
    }
  }
  return out;
}

export function describeError(e: unknown): string {
  try {
    return JSON.stringify(toPlain(e, new WeakSet(), 0));
  } catch {
    return String(e);
  }
}

export function debugLog(...args: unknown[]): void {
  console.log("[Moulinette]", ...args);
  const line = document.createElement("div");
  const time = new Date().toISOString().slice(11, 23);
  line.textContent = `${time}  ${args.map(stringify).join(" ")}`;
  const p = panel();
  p.appendChild(line);
  p.scrollTop = p.scrollHeight;
}
