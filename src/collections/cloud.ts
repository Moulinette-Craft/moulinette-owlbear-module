import { MOU_STORAGE, MOU_STORAGE_PUB } from "../constants";
import { MoulinetteClient } from "../clients/moulinette";
import { AssetAction, AssetType, Facet, MediaAsset, MediaCollection, SearchFilters, SearchResults } from "../types";
import { prettyDuration, prettyFilesize, prettyMediaName } from "../utils";
import { addImageToScene } from "../obr/scene";
import { describeError } from "../debug";

// Asset type ids used by the Moulinette Cloud API (shared with the FoundryVTT
// module's MouCollectionAssetTypeEnum). Only the ones with a real Owlbear
// equivalent are mapped - everything else (scenes, actors, items, journals,
// playlists, macros, roll tables, adventures, PDFs, scene-packer bundles) is
// filtered out of the results entirely. Note that the server's own "type: 2"
// filter bucket (asked for below whenever the UI's "Map" type is selected)
// actually groups Scene(1)/Map(2)/ScenePacker(98) together - matching the
// FoundryVTT module, which supports all three as "maps" - so a page of results
// can still include a few Scene/ScenePacker records; those simply fail the
// `RAW_TYPE_TO_ASSET_TYPE` lookup below and get dropped, same as any other
// unsupported type.
const RAW_TYPE_TO_ASSET_TYPE: Record<number, AssetType> = {
  2: AssetType.Map,
  3: AssetType.Image,
  7: AssetType.Audio,
};
const ASSET_TYPE_TO_RAW_TYPE: Record<string, number> = {
  [AssetType.Map]: 2,
  [AssetType.Image]: 3,
  [AssetType.Audio]: 7,
};

interface RawPack {
  name: string;
  path: string;
  creator_ref: string;
  creator: string;
}

interface RawAsset {
  _id: string | number;
  filepath: string;
  type: number;
  perms: number;
  filesize: number;
  /** Already a full, signed relative path+query ("name_thumb.webp?se=...&sig=...") - not present for locked/preview-only assets. */
  thumb?: string;
  name?: string;
  pack_ref: string | number;
  pack: RawPack;
  size?: { width: number; height: number };
  audio?: { duration: number };
}

function toMediaAsset(raw: RawAsset): MediaAsset | null {
  const type = RAW_TYPE_TO_ASSET_TYPE[raw.type];
  if (!type || !raw.pack) return null;

  const locked = raw.perms < 0;
  const basePath = raw.filepath.replace(/\.[^/.]+$/, "");
  // Accessible assets get the real (signed) thumbnail; locked previews fall
  // back to the lower-quality public CDN copy, which needs no signature.
  const previewUrl =
    type !== AssetType.Audio && raw.thumb
      ? `${MOU_STORAGE}${raw.pack.creator_ref}/${raw.pack.path}/${raw.thumb}`
      : `${MOU_STORAGE_PUB}${raw.pack.creator_ref}/${raw.pack.path}/${basePath}.${type === AssetType.Audio ? "ogg" : "webp"}`;

  const meta: MediaAsset["meta"] = [];
  if (type === AssetType.Audio && raw.audio) {
    meta.push({ icon: "fa-regular fa-stopwatch", text: prettyDuration(raw.audio.duration), hint: "Duration" });
  }
  if ((type === AssetType.Image || type === AssetType.Map) && raw.size) {
    meta.push({
      icon: "fa-solid fa-ruler-combined",
      text: `${raw.size.width} x ${raw.size.height}`,
      hint: "Dimensions",
    });
  }
  meta.push({ icon: "fa-solid fa-weight-hanging", text: prettyFilesize(raw.filesize, 0), hint: "File size" });

  return {
    id: String(raw._id),
    type,
    name: raw.name && raw.name.length > 0 ? raw.name : prettyMediaName(raw.filepath),
    url: raw.filepath,
    previewUrl,
    creator: raw.pack.creator,
    creatorUrl: null, // only available from the full per-asset record - see executeAction("support")
    pack: raw.pack.name,
    packId: String(raw.pack_ref),
    width: raw.size?.width,
    height: raw.size?.height,
    meta,
    free: raw.perms === 0,
    locked,
    flags: {},
  };
}

interface RawPackFacet {
  creator: string;
  name: string;
  pack_ref: string | number;
  total_assets: number;
}

interface FacetCache {
  searchTerms?: string;
  type?: AssetType;
  creator?: string;
  types?: { type: AssetType; count: number }[];
  creators?: Facet[];
  /** Raw, one entry per (creator, pack) - not yet merged/filtered, since that depends on the currently selected creator. */
  packs?: RawPackFacet[];
}

/** Merges same-named packs (4K/HD variants of the same pack) into one facet entry, the way the FoundryVTT module does. */
function mergePacks(packs: RawPackFacet[]): Facet[] {
  const merged = new Map<string, Facet>();
  for (const p of packs) {
    const name = p.name.replace(/\s+(4K|HD)$/i, "");
    const existing = merged.get(name);
    if (existing) {
      existing.count += p.total_assets;
      existing.id += `;${p.pack_ref}`;
    } else {
      merged.set(name, { id: String(p.pack_ref), name, count: p.total_assets });
    }
  }
  return [...merged.values()];
}

export class CloudCollection implements MediaCollection {
  id = "moulinette-cloud";
  name = "Moulinette Cloud";
  description = "Browse the full Moulinette Cloud marketplace - maps and images from every creator.";
  // Audio is temporarily disabled (not removed) at the user's request, to keep
  // the surface area small while iterating. Re-enable by adding AssetType.Audio
  // back here.
  supportedTypes = [AssetType.Map, AssetType.Image];

  private error: string | null = null;
  private cache: FacetCache = {};

  async initialize(): Promise<void> {
    // Nothing to prefetch: every search hits the server directly (the
    // FoundryVTT module's "Cloud (discover)" mode), unlike a bulk collection
    // that has to download and cache everything up front.
    this.error = null;
  }

  /** Called after connecting/disconnecting the Moulinette account - facets/results depend on the session's access. */
  invalidate(): void {
    this.cache = {};
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

  async getAssetsCount(filters: SearchFilters): Promise<number> {
    return this.cache.types?.find((t) => t.type === filters.type)?.count ?? 0;
  }

  async search(filters: SearchFilters, page: number): Promise<SearchResults> {
    // Mirrors the FoundryVTT module's own caching: facets (types/creators/packs)
    // are relatively expensive to compute server-side, so they're only
    // re-requested when something that actually changes them changed -
    // otherwise the last known facet values are reused as-is.
    const hasSearched = this.cache.searchTerms !== undefined;
    const termsChanged = !hasSearched || this.cache.searchTerms !== filters.searchTerms;
    const typeChanged = termsChanged || this.cache.type !== filters.type;
    const creatorChanged = typeChanged || this.cache.creator !== filters.creator;
    const facets = { types: typeChanged, creators: typeChanged, packs: creatorChanged };

    try {
      const raw = await MoulinetteClient.search({
        searchTerms: filters.searchTerms,
        type: ASSET_TYPE_TO_RAW_TYPE[filters.type],
        creator: filters.creator,
        pack: filters.pack || null,
        wholeWord: filters.wholeWord,
        page,
        facets,
      });
      this.error = null;

      if (raw.types) {
        this.cache.types = raw.types
          .map((t: { _id: number; total_assets: number }) => ({ type: RAW_TYPE_TO_ASSET_TYPE[t._id], count: t.total_assets }))
          .filter((t: { type?: AssetType }): t is { type: AssetType; count: number } => t.type !== undefined);
      }
      if (raw.creators) {
        this.cache.creators = raw.creators.map((c: { name: string; total_assets: number }) => ({ id: c.name, name: c.name, count: c.total_assets }));
      }
      if (raw.packs) {
        // The server returns packs for every creator regardless of the current
        // filter - kept as-is (per-creator filtering happens below, since which
        // creator is selected can change without the packs facet itself needing
        // to be re-fetched).
        this.cache.packs = raw.packs;
      }

      this.cache.searchTerms = filters.searchTerms;
      this.cache.type = filters.type;
      this.cache.creator = filters.creator;

      const packsForCreator = filters.creator ? mergePacks((this.cache.packs ?? []).filter((p) => p.creator === filters.creator)) : [];

      const assets: MediaAsset[] = (raw.assets ?? []).map(toMediaAsset).filter((a: MediaAsset | null): a is MediaAsset => a !== null);

      return {
        assets,
        creators: this.cache.creators ?? [],
        packs: packsForCreator,
        types: this.cache.types ?? [],
      };
    } catch (e) {
      console.error("Moulinette | Cloud search failed", describeError(e));
      this.error = "Could not reach Moulinette Cloud. Check your connection and try again.";
      return { assets: [], creators: [], packs: [], types: [] };
    }
  }

  getActions(asset: MediaAsset): AssetAction[] {
    const actions: AssetAction[] = [];
    if (asset.locked) {
      actions.push({
        id: "support",
        name: "Support the creator to unlock",
        icon: "fa-solid fa-hands-praying",
        primary: true,
        successMessage: "Opened the creator's page in a new tab.",
      });
    } else if (asset.type === AssetType.Audio) {
      actions.push({ id: "play", name: "Play / stop", icon: "fa-solid fa-play-pause", primary: true });
    } else {
      actions.push({ id: "add", name: "Add to scene", icon: "fa-solid fa-file-import", primary: true, successMessage: `Added "${asset.name}" to the scene.` });
      actions.push({ id: "preview", name: "Preview", icon: "fa-solid fa-magnifying-glass" });
    }
    if (!asset.locked) {
      actions.push({ id: "download", name: "Download", icon: "fa-solid fa-cloud-arrow-down", successMessage: "Opened the file in a new tab." });
    }
    if (asset.packId) {
      actions.push({ id: "browse-pack", name: "Browse this pack", icon: "fa-solid fa-box" });
    }
    if (!asset.locked) {
      actions.push({ id: "support", name: "Visit creator", icon: "fa-solid fa-hands-praying", successMessage: "Opened the creator's page in a new tab." });
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

  /** `previewUrl` is only thumbnail quality - the in-app preview overlay wants the real, full-resolution asset. */
  async getPreviewUrl(asset: MediaAsset): Promise<string> {
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
        // Some assets are served with a download disposition rather than
        // rendering inline in a new tab - fine (expected, even) for "Download",
        // but that's exactly why "preview" (see getPreviewUrl()) shows the image
        // in its own in-app overlay instead of opening the URL directly.
        const url = await this.resolveDownloadUrl(asset);
        window.open(url, "_blank");
        break;
      }
      case "support": {
        // creatorUrl isn't part of the search/list response - only the full
        // per-asset record has it, so it's resolved here on demand.
        const full = await MoulinetteClient.getAsset(asset.id);
        if (full.creator_url) window.open(full.creator_url, "_blank");
        break;
      }
    }
  }
}
