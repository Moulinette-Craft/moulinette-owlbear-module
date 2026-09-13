/** Small formatting/DOM helpers. Ported from the FoundryVTT module's MouMediaUtils. */

export function prettyFilesize(bytes: number, decimals = 1): string {
  if (bytes < 1024) return "< 1KB";
  if (bytes < 1024 * 1024) {
    const size = bytes / 1024;
    return decimals === 0 ? `${Math.round(size).toLocaleString()} KB` : `${size.toFixed(decimals)} KB`;
  }
  const size = bytes / (1024 * 1024);
  return decimals === 0 ? `${Math.round(size).toLocaleString()} MB` : `${size.toFixed(decimals)} MB`;
}

export function prettyNumber(n: number, full = false): string {
  if (full) return n.toLocaleString();
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function prettyDuration(seconds: number): string {
  seconds = Math.round(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (v: number) => (v < 10 ? `0${v}` : `${v}`);
  return h === 0 ? `${m}:${pad(s)}` : `${h}:${pad(m)}:${pad(s)}`;
}

export function prettyMediaName(filepath: string): string {
  const clean = decodeURIComponentSafe(filepath).split("?")[0];
  const base = clean.replace(/\.[^/.]+$/, "");
  const name = (base.split("/").pop() || clean)
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
  return name || clean;
}

export function decodeURIComponentSafe(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * Checks whether `term` is found in `haystack`, optionally requiring it to match a
 * whole word (surrounded by the start/end of the string or a non-alphanumeric
 * character) rather than any substring.
 */
export function matchesSearchTerm(haystack: string, term: string, wholeWord?: boolean): boolean {
  const h = haystack.toLocaleLowerCase();
  const t = term.toLocaleLowerCase();
  if (!wholeWord) return h.indexOf(t) >= 0;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(h);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Rasterizes SVG source into a PNG Blob. Owlbear's `OBR.assets.uploadImages()`
 * rejects SVG files outright ("Unsupported file type", found by trial and
 * error) - anything generated client-side as SVG (recolored game-icons.net
 * icons, ...) needs to go through this before it can be uploaded as a scene image.
 */
export async function svgToPngBlob(svg: string, size: number): Promise<Blob> {
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob() returned null"))), "image/png");
  });
}

export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}
