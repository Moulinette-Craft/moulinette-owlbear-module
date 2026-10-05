import OBR from "@owlbear-rodeo/sdk";
import { SoundboardPanel } from "./ui/soundboard";
import { SOUNDBOARD_POPOVER_ID, SOUNDBOARD_PANEL_WIDTH, SOUNDBOARD_POPOVER_WIDTH, SOUNDBOARD_POPOVER_HEIGHT, SOUNDBOARD_MINIMIZED_SIZE } from "./constants";
import { applyObrTheme } from "./obrTheme";

applyObrTheme();
document.documentElement.style.setProperty("--mou-sb-panel-width", `${SOUNDBOARD_PANEL_WIDTH}px`);

const app = document.getElementById("app")!;

// Both views stay in the DOM the whole time (toggled via `hidden`) rather
// than one replacing the other's innerHTML - the full view owns the one and
// only SoundboardPanel instance, which would otherwise lose all of its
// state (what's loaded, what's expanded, what's playing) every time it got
// torn down and rebuilt across a minimize/restore cycle.
app.innerHTML = `
  <div class="mou-sb-page" id="mou-sb-page">
    <div class="mou-sb-header">
      <div class="mou-sb-title"><i class="fa-solid fa-drum"></i> SoundPads &amp; SoundBoards</div>
      <div class="mou-sb-header-actions">
        <button class="mou-btn" id="mou-sb-minimize" title="Minimize"><i class="fa-solid fa-minus"></i></button>
        <button class="mou-btn" id="mou-sb-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="mou-soundboard-content" id="mou-soundboard-content"></div>
  </div>
  <button class="mou-sb-minimized" id="mou-sb-restore" title="Open SoundPads &amp; SoundBoards" hidden>
    <i class="fa-solid fa-drum"></i>
  </button>
`;

const panel = new SoundboardPanel(document.getElementById("mou-soundboard-content")!);
panel.open();

const close = () => OBR.popover.close(SOUNDBOARD_POPOVER_ID);
document.getElementById("mou-sb-close")!.addEventListener("click", close);

const pageEl = document.getElementById("mou-sb-page")!;
const restoreBtn = document.getElementById("mou-sb-restore")!;

const minimize = () => {
  pageEl.hidden = true;
  restoreBtn.hidden = false;
  OBR.popover.setWidth(SOUNDBOARD_POPOVER_ID, SOUNDBOARD_MINIMIZED_SIZE);
  OBR.popover.setHeight(SOUNDBOARD_POPOVER_ID, SOUNDBOARD_MINIMIZED_SIZE);
};

const restore = () => {
  restoreBtn.hidden = true;
  pageEl.hidden = false;
  OBR.popover.setWidth(SOUNDBOARD_POPOVER_ID, SOUNDBOARD_POPOVER_WIDTH);
  OBR.popover.setHeight(SOUNDBOARD_POPOVER_ID, SOUNDBOARD_POPOVER_HEIGHT);
};

document.getElementById("mou-sb-minimize")!.addEventListener("click", minimize);
restoreBtn.addEventListener("click", restore);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!pageEl.hidden) close();
});

// Allow opening this page directly in a normal browser tab (outside of Owlbear
// Rodeo) for quick UI iteration during development - same fallback as main.ts.
if (!OBR.isAvailable) {
  document.getElementById("mou-sb-close")!.hidden = true;
  document.getElementById("mou-sb-minimize")!.hidden = true;
}
