/**
 * Configuration shared across the extension. Values that point at Moulinette's own
 * infrastructure are copied from the FoundryVTT module (moulinette-foundryvtt-module)
 * so both clients talk to the same backend.
 */

export const MOU_SERVER_URL = "https://assets.moulinette.cloud";
export const MOU_API = `${MOU_SERVER_URL}/api/v2`;
export const MOU_STORAGE = "https://mttestorage.blob.core.windows.net/";
export const MOU_STORAGE_PUB = "https://moulinette-previews.nyc3.cdn.digitaloceanspaces.com/";

export const PATREON_CLIENT_ID = "K3ofcL8XyaObRrO_5VPuzXEPnOVCIW3fbLIt6Vygt_YIM6IKxA404ZQ0pZbZ0VkB";
export const DISCORD_CLIENT_ID = "1104472072853405706";

// Local storage keys (per-browser, never synced through OBR room/player metadata -
// the Moulinette session token is private to this device, not shared with other
// players in the room).
export const LS_SESSION_ID = "moulinette:session_id";
export const LS_SETTINGS = "moulinette:settings";
export const LS_LAST_SEARCH = "moulinette:last_search";
export const LS_SOUNDBOARD_LOOPS = "moulinette:soundboard_loops";

export const EXTENSION_ID = "cloud.moulinette.owlbear-media-search";

// Shared between src/action.ts (which opens this modal) and src/ui/browser.ts
// (which needs the same id to close it again - a fullScreen modal replaces the
// entire Owlbear UI with no host-provided close button of its own).
export const MODAL_ID = `${EXTENSION_ID}/browser`;

// Shared between src/ui/browser.ts (which opens this popover) and
// src/soundboardMain.ts (which needs the same id to close it again). A
// separate OBR.popover rather than nested inside MODAL_ID's modal, so the
// Soundboard can stay docked to the screen edge and open at the same time as
// - instead of on top of - the browse modal and the rest of Owlbear's own UI.
export const SOUNDBOARD_POPOVER_ID = `${EXTENSION_ID}/soundboard`;

// The panel itself is drawn flush against the popover iframe's left edge at
// this width; SOUNDBOARD_SHADOW_MARGIN is extra, otherwise-empty iframe width
// reserved to its right so the panel's own box-shadow (see style.css) has
// somewhere to render into - a box-shadow can't paint outside its iframe's
// own rectangle, so without this margin it would just get clipped invisible
// at the edge. The popover is requested at their sum; soundboardMain.ts's
// minimize toggle shrinks it down to SOUNDBOARD_MINIMIZED_SIZE instead.
export const SOUNDBOARD_PANEL_WIDTH = 320;
export const SOUNDBOARD_SHADOW_MARGIN = 32;
export const SOUNDBOARD_POPOVER_WIDTH = SOUNDBOARD_PANEL_WIDTH + SOUNDBOARD_SHADOW_MARGIN;
// Clamped to the actual available height by Owlbear (unconfirmed by the SDK's
// own docs, which have none - found by testing) - comfortably taller than any
// real screen so it always reaches the bottom edge.
export const SOUNDBOARD_POPOVER_HEIGHT = 2000;
export const SOUNDBOARD_MINIMIZED_SIZE = 56;

export const PAGE_SIZE = 60;

// Below this size (in cell-units), a source image found in a Moulinette pack is
// assumed to be built at this many source pixels per grid cell - mirrors the
// FoundryVTT module's "tile size" advanced setting, used to scale maps/props onto
// Owlbear's grid in a way that roughly matches their intended in-game size.
export const DEFAULT_SOURCE_PIXELS_PER_CELL = 100;

// Dimensions (in either direction) above which an image is treated as a "map"
// rather than a small prop/token-sized image.
export const MAP_DIMENSION_THRESHOLD = 1000;

export interface AdvancedSettings {
  image: {
    sourcePixelsPerCell: number;
    fgColor: string;
    bgColor: string; // empty string = transparent background
  };
}

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  image: {
    sourcePixelsPerCell: DEFAULT_SOURCE_PIXELS_PER_CELL,
    fgColor: "#ffffff",
    bgColor: "",
  },
};
