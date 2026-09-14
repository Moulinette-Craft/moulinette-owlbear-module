import OBR, { buildImage, buildImageUpload, Image as ObrImage, ImageAssetType } from "@owlbear-rodeo/sdk";
import { DEFAULT_SOURCE_PIXELS_PER_CELL } from "../constants";
import { loadImage } from "../utils";
import { describeError } from "../debug";

function mimeFromUrl(url: string): string {
  // Game-icons.net and Font Awesome are added via a `data:` URL (recolored SVG or
  // rasterized PNG, built client-side - see gameicons.ts/fontawesome-render.ts).
  // Those have no file extension to inspect (and the base64 payload can't contain
  // "." by construction, so the extension-based lookup below would silently fall
  // through to its "image/png" default even for an SVG) - the MIME type is
  // already right there in the URI itself.
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)/);
    if (match) return match[1];
  }
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

/** World-space position of the current viewport's center, for dropping new items where the user is actually looking. */
async function getViewportCenter() {
  const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  return OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
}

export interface AddImageOptions {
  name: string;
  /** Treated as a full battle-map: placed on the MAP layer. */
  isMap?: boolean;
  /**
   * How many pixels of the *source* image make up one grid cell, as the image was
   * originally authored (mirrors the FoundryVTT module's "tile size" advanced
   * setting). Owlbear scales the image so that many source pixels line up with
   * this scene's own grid cell size - ignored for icons, which are always sized
   * to fit exactly one cell.
   */
  sourcePixelsPerCell?: number;
  description?: string;
}

/**
 * Adds an image to the scene, roughly centered in the player's current view.
 * The image's own `grid.dpi` (how many of its pixels make up one cell) is what
 * Owlbear uses to scale it onto this scene's actual grid - maps use the
 * configurable "source pixels per cell" setting, while icons/props are sized to
 * fill exactly one cell.
 */
export async function addImageToScene(url: string, options: AddImageOptions): Promise<void> {
  const [img, center] = await Promise.all([loadImage(url), getViewportCenter()]);

  const gridDpi = options.isMap
    ? (options.sourcePixelsPerCell ?? DEFAULT_SOURCE_PIXELS_PER_CELL)
    : Math.max(img.naturalWidth, img.naturalHeight);

  const built: ObrImage = buildImage(
    {
      width: img.naturalWidth,
      height: img.naturalHeight,
      mime: mimeFromUrl(url),
      url,
    },
    {
      dpi: gridDpi,
      offset: { x: img.naturalWidth / 2, y: img.naturalHeight / 2 },
    },
  )
    .name(options.name)
    .position(center)
    .layer(options.isMap ? "MAP" : "PROP")
    .build();

  if (options.description) {
    built.description = options.description;
  }

  await OBR.scene.items.addItems([built]);
}

const EXT_FROM_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function blobDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(blob);
  return loadImage(objectUrl)
    .then((img) => ({ width: img.naturalWidth, height: img.naturalHeight }))
    .finally(() => URL.revokeObjectURL(objectUrl));
}

export interface UploadImageOptions {
  name: string;
  /** Treated as a full battle-map (larger default tile, MAP typeHint) rather than a 1-cell prop/icon. */
  isMap?: boolean;
  sourcePixelsPerCell?: number;
  typeHint?: ImageAssetType;
  /**
   * The asset's original URL, if it has one - used to determine a reliable MIME
   * type via `mimeFromUrl()` instead of trusting `blob.type`. Needed for a
   * fetched Blob (Moulinette Cloud): found by trial and error, some storage
   * responses don't set a `Content-Type` Owlbear recognizes even for an
   * ordinary ".png" file, and Owlbear's upload validation checks the Blob's
   * declared type, not the filename extension we give it - a mismatched type
   * fails with "Unsupported file type" regardless of what the file is named.
   * Omit for a Blob this module built itself (game-icons.net, Font Awesome),
   * whose `.type` it set correctly to begin with.
   */
  sourceUrl?: string;
}

/**
 * Adds an image to the scene via Owlbear's asset library rather than
 * `buildImage()` + `addItems()` (see `addImageToScene()`). Needed for two kinds
 * of images `addItems()` can't handle as a direct URL:
 *  - client-generated ones (rasterized game-icons.net icon, Font Awesome glyph,
 *    ...): `addItems()` only accepts a real http(s) URL (a `data:`/`blob:` URL
 *    builds fine locally but fails with "Unable to fetch image: Invalid URL"
 *    once synced, since every other player's own client needs a URL it can
 *    fetch too - there's nothing to fetch for bytes that only ever existed in
 *    this browser's memory).
 *  - Moulinette Cloud assets: their download URL is signed with a short-lived
 *    SAS token (an hour or so) - baking that straight into a scene item's
 *    `image.url` would work today and quietly break for everyone once the
 *    token expires. Uploading the actual bytes gives the item a URL Owlbear
 *    hosts permanently instead.
 *
 * `OBR.assets.uploadImages()` hands the file to Owlbear's own asset library and
 * lets the player place it from there (the same flow as dragging a file in from
 * your computer) - there's no `position` to pass here, and no way to skip
 * straight to a placed item the way `addImageToScene()` does.
 *
 * `blob` must be a raster format (PNG/JPEG/WebP/GIF) - Owlbear's own upload
 * validation rejects SVG outright ("Unsupported file type", found by trial and
 * error), so any client-generated SVG needs rasterizing first (see
 * `svgToPngBlob()` in utils.ts) before it ever reaches this function.
 */
export async function uploadImageToScene(blob: Blob, options: UploadImageOptions): Promise<void> {
  const { width, height } = await blobDimensions(blob);
  const gridDpi = options.isMap ? (options.sourcePixelsPerCell ?? DEFAULT_SOURCE_PIXELS_PER_CELL) : Math.max(width, height);
  const mime = options.sourceUrl ? mimeFromUrl(options.sourceUrl) : blob.type || "image/png";
  const ext = EXT_FROM_MIME[mime] ?? "png";
  const file = new File([blob], `${options.name}.${ext}`, { type: mime });
  const upload = buildImageUpload(file)
    .name(options.name)
    .dpi(gridDpi)
    .offset({ x: width / 2, y: height / 2 })
    .build();
  try {
    await OBR.assets.uploadImages([upload], options.typeHint);
  } catch (e) {
    console.error("[Moulinette] uploadImageToScene: OBR.assets.uploadImages threw", describeError(e));
    throw e;
  }
}

export async function getPlayerRole(): Promise<"GM" | "PLAYER"> {
  return OBR.player.getRole();
}
