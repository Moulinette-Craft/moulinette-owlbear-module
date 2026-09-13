import { MOU_STORAGE, MOU_STORAGE_PUB, PAGE_SIZE } from "../constants";
import { MoulinetteClient } from "../clients/moulinette";
import { AssetAction, AssetType, Facet, MediaAsset, MediaCollection, SearchFilters, SearchResults } from "../types";
import { matchesSearchTerm, prettyDuration, prettyFilesize, prettyMediaName } from "../utils";
import { addImageToScene } from "../obr/scene";

// Asset type ids used by the Moulinette Cloud API (shared with the FoundryVTT
// module's MouCollectionAssetTypeEnum). Only the ones with a real Owlbear
// equivalent are mapped - everything else (scenes, actors, items, journals,
// playlists, macros, roll tables, adventures, PDFs, scene-packer bundles) is
// filtered out of the results entirely.
const RAW_TYPE_TO_ASSET_TYPE: Record<number, AssetType> = {
  2: AssetType.Map,
  3: AssetType.Image,
  7: AssetType.Audio,
};

interface RawAsset {
  _id: string;
  filepath: string;
  type: number;
  perms: number;
  filesize: number;
  thumb?: string;
  name?: string;
  creator_url?: string;
  pack_ref: string;
  pack: { name: string; path: string; creator_ref: string; creator: string; sas?: string };
  size?: { width: number; height: number };
  audio?: { duration: number };
}

function toMediaAsset(raw: RawAsset): MediaAsset | null {
  const type = RAW_TYPE_TO_ASSET_TYPE[raw.type];
  if (!type) return null;

  const basePath = raw.filepath.replace(/\.[^/.]+$/, "");
  let previewUrl =
    type === AssetType.Audio
      ? `${MOU_STORAGE_PUB}${raw.pack.creator_ref}/${raw.pack.path}/${basePath}.ogg`
      : `${MOU_STORAGE_PUB}${raw.pack.creator_ref}/${raw.pack.path}/${basePath}.webp`;
  if (type !== AssetType.Audio && raw.thumb) {
    previewUrl = `${MOU_STORAGE}${raw.pack.creator_ref}/${raw.pack.path}/${raw.thumb}`;
  }

  const meta: MediaAsset["meta"] = [];
  if (type === AssetType.Audio && raw.audio) {
    meta.push({ icon: "fa-regular fa-stopwatch", text: prettyDuration(raw.audio.duration), hint: "Duration" });
  }
  if ((type === AssetType.Image || type === AssetType.Map) && raw.size) {
    meta.push({
      icon: "fa-regular fa-expand-wide",
      text: `${raw.size.width} x ${raw.size.height}`,
      hint: "Dimensions",
    });
  }
  meta.push({ icon: "fa-regular fa-weight-hanging", text: prettyFilesize(raw.filesize, 0), hint: "File size" });

  return {
    id: raw._id,
    type,
    name: raw.name && raw.name.length > 0 ? raw.name : prettyMediaName(raw.filepath),
    url: raw.filepath,
    previewUrl,
    creator: raw.pack.creator,
    creatorUrl: raw.creator_url ?? null,
    pack: raw.pack.name,
    packId: raw.pack_ref,
    width: raw.size?.width,
    height: raw.size?.height,
    meta,
    free: raw.perms === 0,
    flags: {},
  };
}

export class CloudCollection implements MediaCollection {
  id = "moulinette-cloud";
  name = "Moulinette Cloud";
  description =
    "Your own content and content from creators you support on Moulinette - maps, images and sound effects.";
  supportedTypes = [AssetType.Map, AssetType.Image, AssetType.Audio];

  private assets: MediaAsset[] = [];
  private error: string | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.error = null;
    try {
      const { assets } = await MoulinetteClient.getAllAssets();
      this.assets = assets.map(toMediaAsset).filter((a): a is MediaAsset => a !== null);
      this.initialized = true;
    } catch (e) {
      console.error("Moulinette | Failed to load Moulinette Cloud assets", e);
      this.error = "Could not reach Moulinette Cloud. Check your connection and try again.";
    }
  }

  /** Called after connecting/disconnecting the Moulinette account so the next search refetches. */
  invalidate(): void {
    this.initialized = false;
    this.assets = [];
  }

  supportsType(type: AssetType): boolean {
    return this.supportedTypes.includes(type);
  }

  isBrowsable(): boolean {
    return true;
  }

  getError(): string | null {
    return this.error;
  }

  private filtered(filters: SearchFilters): MediaAsset[] {
    return this.assets.filter((asset) => {
      if (asset.type !== filters.type) return false;
      if (filters.creator && asset.creator !== filters.creator) return false;
      if (filters.pack && asset.packId !== filters.pack) return false;
      if (filters.searchTerms) {
        for (const term of filters.searchTerms.split(" ").filter(Boolean)) {
          if (!matchesSearchTerm(asset.name, term, filters.wholeWord)) return false;
        }
      }
      return true;
    });
  }

  async getAssetsCount(filters: SearchFilters): Promise<number> {
    return this.filtered(filters).length;
  }

  async search(filters: SearchFilters, page: number, pageSize = PAGE_SIZE): Promise<SearchResults> {
    const withoutCreatorPack = { ...filters, creator: "", pack: "" };
    const withoutPack = { ...filters, pack: "" };

    const creatorsMap = new Map<string, number>();
    for (const a of this.filtered(withoutCreatorPack)) {
      creatorsMap.set(a.creator || "", (creatorsMap.get(a.creator || "") ?? 0) + 1);
    }
    const creators: Facet[] = [...creatorsMap.entries()]
      .map(([id, count]) => ({ id, name: id, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let packs: Facet[] = [];
    if (filters.creator) {
      const packsMap = new Map<string, { name: string; count: number }>();
      for (const a of this.filtered(withoutPack)) {
        if (!a.packId) continue;
        const cur = packsMap.get(a.packId) ?? { name: a.pack || a.packId, count: 0 };
        cur.count++;
        packsMap.set(a.packId, cur);
      }
      packs = [...packsMap.entries()]
        .map(([id, v]) => ({ id, name: v.name, count: v.count }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const typeCounts = new Map<AssetType, number>();
    for (const t of this.supportedTypes) {
      typeCounts.set(t, this.filtered({ ...filters, type: t }).length);
    }

    const all = this.filtered(filters);
    const assets = all.slice(page * pageSize, (page + 1) * pageSize);

    return {
      assets,
      creators,
      packs,
      types: [...typeCounts.entries()].map(([type, count]) => ({ type, count })),
    };
  }

  getActions(asset: MediaAsset): AssetAction[] {
    const actions: AssetAction[] = [];
    if (asset.type === AssetType.Audio) {
      actions.push({ id: "play", name: "Play / stop", icon: "fa-solid fa-play-pause", primary: true });
    } else {
      actions.push({ id: "add", name: "Add to scene", icon: "fa-solid fa-file-import", primary: true });
      actions.push({ id: "preview", name: "Preview", icon: "fa-solid fa-eyes" });
    }
    actions.push({ id: "download", name: "Download", icon: "fa-solid fa-cloud-arrow-down" });
    if (asset.packId) {
      actions.push({ id: "browse-pack", name: "Browse this pack", icon: "fa-solid fa-boxes-stacked" });
    }
    if (asset.creatorUrl) {
      actions.push({ id: "support", name: "Visit creator", icon: "fa-solid fa-hands-praying" });
    }
    return actions;
  }

  private async resolveDownloadUrl(asset: MediaAsset): Promise<string> {
    const full = await MoulinetteClient.getAsset(asset.id);
    return `${full.base_url}/${full.file_url}`;
  }

  /** Audio's `previewUrl` is only a lightweight sample clip - "Play" needs the real asset. */
  async getPlaybackUrl(asset: MediaAsset): Promise<string> {
    if (asset.type !== AssetType.Audio) return asset.previewUrl;
    return this.resolveDownloadUrl(asset);
  }

  async executeAction(actionId: string, asset: MediaAsset): Promise<void> {
    switch (actionId) {
      case "add": {
        const url = await this.resolveDownloadUrl(asset);
        await addImageToScene(url, { name: asset.name, isMap: asset.type === AssetType.Map });
        break;
      }
      case "download": {
        const url = await this.resolveDownloadUrl(asset);
        window.open(url, "_blank");
        break;
      }
      case "support":
        if (asset.creatorUrl) window.open(asset.creatorUrl, "_blank");
        break;
    }
  }
}
