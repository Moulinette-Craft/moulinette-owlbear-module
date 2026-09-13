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

export const EXTENSION_ID = "cloud.moulinette.owlbear-media-search";

// Shared between src/action.ts (which opens this modal) and src/ui/browser.ts
// (which needs the same id to close it again - a fullScreen modal replaces the
// entire Owlbear UI with no host-provided close button of its own).
export const MODAL_ID = `${EXTENSION_ID}/browser`;

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
