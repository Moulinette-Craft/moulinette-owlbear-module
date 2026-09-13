import { PAGE_SIZE } from "../constants";
import { AssetAction, AssetType, Facet, MediaAsset, MediaCollection, SearchFilters, SearchResults } from "../types";
import { copyToClipboard, matchesSearchTerm } from "../utils";
import { getAdvancedSettings } from "../storage";
import { addImageToScene } from "../obr/scene";
import { rasterizeFontAwesomeIcon } from "../fontawesome-render";

interface IconEntry {
  id: string;
  styles: string[];
}

type IconData = Record<string, IconEntry[]>; // family -> icons

function classNameFor(icon: string, family: string, style: string): string {
  let className = `fa-${icon}`;
  if (style) className = `fa-${style} ${className}`;
  if (family !== "classic") className = `fa-${family} ${className}`;
  return className;
}

export class FontAwesomeCollection implements MediaCollection {
  id = "fontawesome";
  name = "Font Awesome";
  description = "The Font Awesome Free icon set, pre-installed in Owlbear via CDN - rasterized on demand.";
  supportedTypes = [AssetType.Icon];

  private data: IconData = {};
  private lastCount = 0;

  async initialize(): Promise<void> {
    if (Object.keys(this.data).length > 0) return;
    // Resolved against the page's own URL (document.baseURI), not a root-absolute
    // "/data/...": this file is copied next to index.html by Vite (from public/),
    // wherever that ends up hosted - including under a GitHub Pages project
    // subpath such as "/moulinette-owlbear-module/".
    const response = await fetch(new URL("data/fa-icons.json", document.baseURI));
    this.data = await response.json();
  }

  supportsType(type: AssetType): boolean {
    return type === AssetType.Icon;
  }

  isBrowsable(): boolean {
    return true;
  }

  getError(): string | null {
    return null;
  }

  async getAssetsCount(): Promise<number> {
    return this.lastCount;
  }

  private allAssets(filters: SearchFilters): MediaAsset[] {
    const assets: MediaAsset[] = [];
    for (const family of Object.keys(this.data)) {
      if (filters.creator && filters.creator !== family) continue;
      for (const icon of this.data[family]) {
        if (filters.searchTerms) {
          const terms = filters.searchTerms.split(" ").filter(Boolean);
          if (!terms.every((t) => matchesSearchTerm(icon.id, t, filters.wholeWord))) continue;
        }
        const styles = icon.styles.length > 0 ? icon.styles : [""];
        for (const style of styles) {
          if (filters.pack && filters.pack !== style) continue;
          const className = classNameFor(icon.id, family, style);
          assets.push({
            id: className,
            type: AssetType.Icon,
            name: icon.id,
            url: className,
            previewUrl: className,
            iconGlyph: className,
            creator: family,
            pack: style || null,
            packId: style || null,
            meta: [],
            flags: {},
          });
        }
      }
    }
    return assets;
  }

  async search(filters: SearchFilters, page: number): Promise<SearchResults> {
    if (filters.type !== AssetType.Icon) {
      return { assets: [], creators: [], packs: [], types: [] };
    }
    const all = this.allAssets(filters);
    this.lastCount = all.length;

    const creatorsMap = new Map<string, number>();
    for (const a of this.allAssets({ ...filters, creator: "" })) {
      creatorsMap.set(a.creator!, (creatorsMap.get(a.creator!) ?? 0) + 1);
    }
    const creators: Facet[] = [...creatorsMap.entries()].map(([id, count]) => ({ id, name: id, count })).sort((a, b) => a.name.localeCompare(b.name));

    let packs: Facet[] = [];
    if (filters.creator) {
      const packsMap = new Map<string, number>();
      for (const a of this.allAssets({ ...filters, pack: "" })) {
        const key = a.pack || "";
        packsMap.set(key, (packsMap.get(key) ?? 0) + 1);
      }
      packs = [...packsMap.entries()].map(([id, count]) => ({ id, name: id || "default", count })).sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      assets: all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
      creators,
      packs,
      types: [{ type: AssetType.Icon, count: all.length }],
    };
  }

  getActions(): AssetAction[] {
    return [
      { id: "add", name: "Add to scene", icon: "fa-solid fa-file-import", primary: true },
      { id: "clipboard", name: "Copy class name", icon: "fa-solid fa-clipboard" },
      { id: "fontawesome", name: "Open on Font Awesome", icon: "fa-brands fa-font-awesome" },
    ];
  }

  async executeAction(actionId: string, asset: MediaAsset): Promise<void> {
    switch (actionId) {
      case "add": {
        const { fgColor } = getAdvancedSettings().image;
        const dataUrl = await rasterizeFontAwesomeIcon(asset.id, fgColor || "#000000");
        await addImageToScene(dataUrl, { name: asset.name });
        break;
      }
      case "clipboard":
        await copyToClipboard(asset.id);
        break;
      case "fontawesome":
        window.open(`https://fontawesome.com/search?q=${encodeURIComponent(asset.name)}`, "_blank");
        break;
    }
  }
}
