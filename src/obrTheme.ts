import OBR, { Theme } from "@owlbear-rodeo/sdk";

/**
 * Applies Owlbear's own live theme (OBR.theme) as overrides on top of this
 * extension's hardcoded --mou-* CSS variables (see :root in style.css),
 * instead of guessing colors - so a page using it looks like a natural part
 * of Owlbear's own UI (same surface/text colors, light/dark mode included)
 * rather than a visually mismatched popup. Keeps the Moulinette accent color
 * (--mou-accent, --mou-accent-contrast) as-is: that's this extension's own
 * brand identity for interactive elements, not something meant to blend in.
 *
 * Call once per page, as early as possible (before first paint ideally).
 * Re-applies live if the person switches Owlbear's own theme while this page
 * is open (OBR.theme.onChange).
 */
export function applyObrTheme(): void {
  const apply = (theme: Theme) => {
    const root = document.documentElement.style;
    root.setProperty("--mou-bg", theme.background.default);
    root.setProperty("--mou-bg-alt", theme.background.paper);
    root.setProperty("--mou-bg-card", theme.background.paper);
    root.setProperty("--mou-text", theme.text.primary);
    root.setProperty("--mou-text-dim", theme.text.secondary);
    root.setProperty("--mou-border", theme.text.disabled);
    document.documentElement.dataset.theme = theme.mode.toLowerCase();
  };

  OBR.onReady(async () => {
    try {
      apply(await OBR.theme.getTheme());
      OBR.theme.onChange(apply);
    } catch (e) {
      // Falls back to the hardcoded dark-mode defaults in style.css - not
      // worth surfacing to the person, this is a cosmetic nicety only.
      console.error("Moulinette | Failed to read Owlbear's theme", e);
    }
  });
}
