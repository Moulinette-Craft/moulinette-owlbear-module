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

/**
 * Adds a client-generated image (rasterized game-icons.net icon, Font Awesome
 * glyph, ...) to the scene. Unlike `addImageToScene()`, this does NOT go through
 * `buildImage()` + `addItems()`: Owlbear's scene items only accept real http(s)
 * image URLs (found by trial and error - a `data:` URL builds fine locally but
 * fails to render with "Unable to fetch image: Invalid URL" once synced, since
 * other players' clients need an actual URL to fetch, not bytes that only exist
 * in this browser's memory). `OBR.assets.uploadImages()` is the SDK's own way to
 * hand it a real Blob instead: Owlbear hosts it and lets the player click on the
 * scene to place it - the same flow as dragging a file in from your computer, so
 * there's no `position` to pass here.
 *
 * `blob` must be a raster format (PNG/JPEG/WebP/GIF) - Owlbear's own upload
 * validation rejects SVG outright ("Unsupported file type", also found by trial
 * and error), so any client-generated SVG needs rasterizing first (see
 * `svgToPngBlob()` in utils.ts) before it ever reaches this function.
 */
export async function uploadImageToScene(
  blob: Blob,
  options: { name: string; size: number; typeHint?: ImageAssetType },
): Promise<void> {
  const ext = EXT_FROM_MIME[blob.type] ?? "png";
  const file = new File([blob], `${options.name}.${ext}`, { type: blob.type });
  const upload = buildImageUpload(file)
    .name(options.name)
    .dpi(options.size)
    .offset({ x: options.size / 2, y: options.size / 2 })
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
