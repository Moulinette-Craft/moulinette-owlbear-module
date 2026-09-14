import { PAGE_SIZE } from "../constants";
import { GameIconsClient } from "../clients/gameicons";
import { AssetAction, AssetType, MediaAsset, MediaCollection, SearchFilters, SearchResults } from "../types";
import { getAdvancedSettings } from "../storage";
import { uploadImageToScene } from "../obr/scene";

export class GameIconsCollection implements MediaCollection {
  id = "gameicons";
  name = "Game-icons.net";
  description = "Thousands of free game icons by game-icons.net, recolorable. \"Add\" uploads to your Owlbear asset library - drag it onto the map from the Assets panel to place it.";
  supportedTypes = [AssetType.Icon];

  private lastCount = 0;
  private error: string | null = null;

  async initialize(): Promise<void> {
    this.error = null;
  }

  supportsType(type: AssetType): boolean {
    return type === AssetType.Icon;
  }

  isBrowsable(): boolean {
    return false; // search-term required, like the FoundryVTT module
  }

  getError(): string | null {
    return this.error;
  }

  async getAssetsCount(): Promise<number> {
    return this.lastCount;
  }

  async search(filters: SearchFilters, page: number): Promise<SearchResults> {
    if (filters.type !== AssetType.Icon || !filters.searchTerms || filters.searchTerms.trim().length < 3) {
      this.lastCount = 0;
      return { assets: [], creators: [], packs: [], types: [{ type: AssetType.Icon, count: 0 }] };
    }
    try {
      const { icons, count } = await GameIconsClient.searchIcons(filters.searchTerms, page, PAGE_SIZE);
      this.lastCount = count;
      const assets: MediaAsset[] = icons.map((icon) => ({
        id: icon.id,
        type: AssetType.Icon,
        name: icon.name,
        url: icon.url,
        previewUrl: icon.url,
        creator: icon.author,
        creatorUrl: "https://game-icons.net/about.html#authors",
        meta: [],
        flags: {},
      }));
      return { assets, creators: [], packs: [], types: [{ type: AssetType.Icon, count }] };
    } catch (e) {
      console.error("Moulinette | game-icons.net search failed", e);
      this.error = "Could not reach game-icons.net.";
      return { assets: [], creators: [], packs: [], types: [] };
    }
  }

  getActions(): AssetAction[] {
    return [
      {
        id: "add",
        name: "Add to Owlbear's asset library - then drag it onto the map from there",
        icon: "fa-solid fa-upload",
        primary: true,
        // Owlbear shows a "click to place" cursor right after the upload, but
        // found by testing that it's unreliable when triggered this way (via an
        // extension's upload call rather than a direct user gesture) - it can
        // silently do nothing, or throw a clipboard error, depending on timing.
        // Steering straight to the reliable path (the Assets panel) instead of
        // suggesting that cursor will work.
        successMessage: "Added to your asset library. Press Esc to dismiss the placement cursor, then open the Assets panel and drag it onto the map from there.",
      },
      { id: "download", name: "Download SVG", icon: "fa-solid fa-cloud-arrow-down", successMessage: "Opened the SVG in a new tab." },
    ];
  }

  async executeAction(actionId: string, asset: MediaAsset): Promise<void> {
    const { fgColor, bgColor } = getAdvancedSettings().image;
    switch (actionId) {
      case "add": {
        // A real hosted URL (buildImage/addItems, the instant-placement
        // mechanism Moulinette Cloud uses) was tried and reverted: it doesn't
        // render correctly on the scene for an externally-hosted resource like
        // this. OBR.assets.uploadImages() (adds it to Owlbear's own asset
        // library, from which the user places it themselves) is the reliable
        // path - it does trigger an immediate "click to place" cursor that can
        // throw a clipboard error right after upload (an Owlbear-side quirk,
        // not something this extension controls), but the icon is safely in
        // the library regardless, ready to drag onto the map from the Assets
        // panel at any time even if that immediate placement attempt fails.
        // asset.id, not asset.url - see the doc comment on GameIconsClient.recolor().
        const blob = await GameIconsClient.recoloredPngBlob(asset.id, fgColor, bgColor);
        await uploadImageToScene(blob, { name: asset.name, size: GameIconsClient.ICON_SIZE, typeHint: "PROP" });
        break;
      }
      case "download": {
        const dataUrl = await GameIconsClient.recoloredDataUrl(asset.id, fgColor, bgColor);
        window.open(dataUrl, "_blank");
        break;
      }
    }
  }
}
