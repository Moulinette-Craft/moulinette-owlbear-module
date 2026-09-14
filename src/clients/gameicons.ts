import { MOU_API } from "../constants";
import { svgToPngBlob } from "../utils";

export interface GameIcon {
  id: string; // e.g. "1x1/faithtoken/dragon-head"
  author: string;
  name: string;
  url: string; // white-on-transparent SVG, hosted on game-icons.net
}

const ALGOLIA_ENDPOINT = "https://9hq1yxukvc-3.algolianet.com/1/indexes/*/queries?x-algolia-application-id=9HQ1YXUKVC&x-algolia-api-key=fa437c6f1fcba0f93608721397cd515d";

function extractText(html: string): string {
  const span = document.createElement("span");
  span.innerHTML = html;
  return span.textContent || span.innerText || "";
}

function titleCase(s: string): string {
  return s.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
}

let cachedCount = 0;

export const GameIconsClient = {
  async getIconsCount(): Promise<number> {
    if (cachedCount > 0) return cachedCount;
    const { count } = await this.searchIcons(" ", 0, 1);
    return count;
  },

  async searchIcons(terms: string, page: number, hitsPerPage: number): Promise<{ icons: GameIcon[]; count: number }> {
    if (!terms || terms.trim().length === 0) return { icons: [], count: 0 };
    const body = {
      requests: [{ indexName: "icons", hitsPerPage, params: `query=${encodeURIComponent(terms)}&page=${page}` }],
    };
    const response = await fetch(ALGOLIA_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`game-icons.net search failed: HTTP ${response.status}`);
    const json = await response.json();
    const result = json.results?.[0];
    if (!result) return { icons: [], count: 0 };
    cachedCount = result.nbHits ?? cachedCount;

    const icons: GameIcon[] = (result.hits ?? []).map((hit: any) => ({
      id: hit.id,
      author: titleCase(extractText(hit.id.split("/")[1] || "").replace(/-/g, " ")),
      name: hit.name,
      url: `https://game-icons.net/icons/ffffff/000000/${hit.id}.svg`,
    }));
    return { icons, count: result.nbHits ?? 0 };
  },

  /**
   * Downloads the icon's raw SVG (through Moulinette's public relay, since
   * game-icons.net doesn't allow cross-origin fetches directly) and recolors it,
   * returning the resulting SVG source as plain text.
   *
   * @param iconId - The icon's *id* (e.g. "1x1/faithtoken/dragon-head", i.e.
   * `GameIcon.id`, not `GameIcon.url`). Despite the relay's own field being named
   * "url", found by trial and error that it actually expects this bare id and
   * 400s on the full https://game-icons.net/... URL.
   */
  async recolor(iconId: string, fgColor: string, bgColor: string): Promise<string> {
    const response = await fetch(`${MOU_API}/gameicons/download`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ url: iconId }),
    });
    if (!response.ok) throw new Error(`Failed to download icon: HTTP ${response.status}`);
    let svg = await response.text();

    if (fgColor.toLowerCase() !== "#ffffff" || bgColor) {
      const fg = fgColor || "#000000";
      const bg = bgColor || "transparent";
      svg = svg.replace(`fill="#fff"`, `fill="${fg}"`).replace("<path d=", `<path fill="${bg}" d=`);
    }
    // Firefox needs explicit intrinsic dimensions to rasterize the SVG at a sane size.
    svg = svg.replace("<svg", `<svg width="${GameIconsClient.ICON_SIZE}" height="${GameIconsClient.ICON_SIZE}"`);

    return svg;
  },

  /** Size (in px) baked into the recolored SVG by `recolor()` above. */
  ICON_SIZE: 512,

  /** As a `data:` URL - only good for a thumbnail preview or a "save as" link, never for a scene item (see uploadImageToScene()). */
  async recoloredDataUrl(iconId: string, fgColor: string, bgColor: string): Promise<string> {
    const svg = await GameIconsClient.recolor(iconId, fgColor, bgColor);
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  },

  /**
   * As a PNG Blob, suitable for `OBR.assets.uploadImages()` / `uploadImageToScene()`.
   * Owlbear rejects SVG uploads outright ("Unsupported file type"), so the
   * recolored SVG is rasterized to PNG first - see `svgToPngBlob()`.
   */
  async recoloredPngBlob(iconId: string, fgColor: string, bgColor: string): Promise<Blob> {
    const svg = await GameIconsClient.recolor(iconId, fgColor, bgColor);
    return svgToPngBlob(svg, GameIconsClient.ICON_SIZE);
  },
};
