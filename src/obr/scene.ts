import OBR, { buildImage, Image as ObrImage } from "@owlbear-rodeo/sdk";
import { DEFAULT_SOURCE_PIXELS_PER_CELL } from "../constants";
import { loadImage } from "../utils";

function mimeFromUrl(url: string): string {
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

export async function getPlayerRole(): Promise<"GM" | "PLAYER"> {
  return OBR.player.getRole();
}
