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
