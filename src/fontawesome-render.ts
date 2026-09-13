/**
 * Rasterizes a Font Awesome icon (given as its CSS class list, e.g. "fa-solid
 * fa-dragon") into a PNG data URL, so it can be dropped onto the Owlbear scene as
 * a regular image item. Owlbear has nowhere to reference a live font glyph (unlike
 * FoundryVTT, where several of its own UI fields accept a Font Awesome class
 * directly), so turning the icon into a small bitmap is the only way to actually
 * use it on the canvas.
 *
 * The icon's Unicode codepoint isn't looked up from a bundled table: it's read
 * straight from the `::before` pseudo-element Font Awesome's own stylesheet
 * generates for that class, which is the same mechanism the browser itself uses to
 * paint the icon - this keeps the icon list (fa-icons.json) a plain list of names
 * with no codepoint data to keep in sync with a particular Font Awesome release.
 */
export async function rasterizeFontAwesomeIcon(className: string, color: string, size = 256): Promise<string> {
  const probe = document.createElement("i");
  probe.className = className;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.left = "-9999px";
  document.body.appendChild(probe);

  try {
    const before = getComputedStyle(probe, "::before");
    const char = before.content.replace(/^["']|["']$/g, "");
    const fontFamily = before.fontFamily;
    const fontWeight = before.fontWeight || "900";

    if (!char || char === "none") {
      throw new Error(`No glyph found for Font Awesome class "${className}"`);
    }

    // Make sure the webfont is actually loaded before drawing, otherwise canvas
    // silently falls back to a fallback glyph (a blank box) the first time an icon
    // of that style is rasterized.
    await document.fonts.load(`${fontWeight} ${size}px ${fontFamily}`);
    await document.fonts.ready;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontWeight} ${Math.round(size * 0.8)}px ${fontFamily}`;
    ctx.fillText(char, size / 2, size / 2 + size * 0.03);

    return canvas.toDataURL("image/png");
  } finally {
    probe.remove();
  }
}
