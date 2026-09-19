import { MOU_STORAGE, MOU_STORAGE_PUB } from "../constants";
import { MoulinetteClient } from "../clients/moulinette";
import { AssetAction, AssetType, Facet, MediaAsset, MediaCollection, SearchFilters, SearchResults } from "../types";
import { prettyDuration, prettyFilesize, prettyMediaName } from "../utils";
import { uploadImageToScene } from "../obr/scene";
import { Auth } from "../auth";
import { describeError } from "../debug";

// Asset type ids used by the Moulinette Cloud API (shared with the FoundryVTT
// module's MouCollectionAssetTypeEnum). Only the ones with a real Owlbear
// equivalent are mapped - everything else (actors, items, journals, playlists,
// macros, roll tables, adventures, PDFs, scene-packer bundles) is filtered out
// of the results entirely.
//
// Scene(1) is mapped to Map on purpose: found by testing the live API directly,
// the server's own "type: 2" filter bucket (requested below whenever the UI's
// "Map" type is selected) always mixes Scene(1) records into a "type: 2"
// request - there's no request parameter that returns Map without Scene, since
// that's an intentional server-side convention (Foundry, its main client,
// treats a Scene as just another kind of importable map). A Scene's own file is
// a full FoundryVTT document (walls, lights, tokens - useless to Owlbear
// directly), but resolveDownloadUrl() below extracts its background image/video
// the same way the FoundryVTT module does, so it can still be added like any
// other map instead of being silently dropped.
const RAW_TYPE_TO_ASSET_TYPE: Record<number, AssetType> = {
  1: AssetType.Map,
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
  /** Dominant color of the thumbnail, computed server-side, without the leading "#" - only present for Scene/Map assets (mirrors the FoundryVTT module's `background_color`/`main_color`). */
  main_color?: string;
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
    // Scene/Map thumbnails are a render of a whole (often padded) canvas, not
    // a full-bleed image - `main_color` is the dominant color computed
    // server-side for exactly this purpose, so it's carried straight from the
    // search result rather than something to fetch/derive ourselves.
    flags: { isScene: raw.type === 1, bgColor: type === AssetType.Map && raw.main_color ? `#${raw.main_color}` : undefined },
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
  description =
    "Browse the full Moulinette Cloud marketplace - maps and images from every creator. \"Add\" uploads to your Owlbear asset library - drag it onto the map from the Assets panel to place it.";
  // Audio is temporarily disabled (not removed) at the user's request, to keep
  // the surface area small while iterating. Re-enable by adding AssetType.Audio
  // back here.
  supportedTypes = [AssetType.Map, AssetType.Image];

  private error: string | null = null;
  private cache: FacetCache = {};
  // Tracks the server's own page index separately from the "page" the UI passes
  // in (see search() below) - the two drift apart whenever raw pages get
  // skipped for being entirely Scene/ScenePacker.
  private nextRawPage = 0;

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
    let facets = { types: typeChanged, creators: typeChanged, packs: creatorChanged };

    if (page === 0) this.nextRawPage = 0;

    try {
      const assets: MediaAsset[] = [];
      // The server's "Map" bucket bundles Scene/Map/ScenePacker together (see
      // the note on RAW_TYPE_TO_ASSET_TYPE above), so a raw page - or even every
      // remaining raw page of a small, Scene-only pack - can filter down to zero
      // usable assets despite the server reporting plenty of "total_assets" for
      // it. Stopping at the first empty-after-filtering page (instead of
      // continuing to the next raw page) was exactly the bug reported: a pack
      // showing "20 entries" but displaying "0" as soon as its first raw page
      // happened to be all Scene records. Keep pulling raw pages - capped, so a
      // pathologically all-unsupported pack can't spin forever - until either
      // some usable assets are found or the server itself has nothing left.
      const MAX_RAW_FETCHES = 8;
      for (let i = 0; i < MAX_RAW_FETCHES; i++) {
        const raw = await MoulinetteClient.search({
          searchTerms: filters.searchTerms,
          type: ASSET_TYPE_TO_RAW_TYPE[filters.type],
          creator: filters.creator,
          pack: filters.pack || null,
          wholeWord: filters.wholeWord,
          page: this.nextRawPage,
          facets,
        });
        this.nextRawPage++;
        facets = { types: false, creators: false, packs: false }; // only ever needed once per logical search
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
          // The server returns packs for every creator regardless of the
          // current filter - kept as-is (per-creator filtering happens below,
          // since which creator is selected can change without the packs facet
          // itself needing to be re-fetched).
          this.cache.packs = raw.packs;
        }

        const rawAssets: RawAsset[] = raw.assets ?? [];
        if (rawAssets.length === 0) break; // the server truly has nothing more for this filter set

        assets.push(...rawAssets.map(toMediaAsset).filter((a): a is MediaAsset => a !== null));
        if (assets.length > 0) break; // got something to show - let infinite scroll ask for more later if this page is thin
      }

      this.cache.searchTerms = filters.searchTerms;
      this.cache.type = filters.type;
      this.cache.creator = filters.creator;

      const packsForCreator = filters.creator ? mergePacks((this.cache.packs ?? []).filter((p) => p.creator === filters.creator)) : [];

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
      actions.push({
        id: "add",
        name: "Add to Owlbear's asset library - then drag it onto the map from there",
        icon: "fa-solid fa-upload",
        primary: true,
        successMessage: "Added to your asset library. Press Esc to dismiss the placement cursor, then open the Assets panel and drag it onto the map from there.",
      });
      actions.push({ id: "preview", name: "Preview", icon: "fa-solid fa-magnifying-glass" });
    }
    if (!asset.locked) {
      actions.push({ id: "download", name: "Download", icon: "fa-solid fa-cloud-arrow-down", successMessage: "Opened the file in a new tab." });
    }
    if (asset.packId) {
      actions.push({ id: "browse-pack", name: "Browse this pack", icon: "fa-solid fa-box" });
    }
    // Nudges an anonymous/unconnected visitor to go support the creator - not
    // needed once the person is signed in and already has download access,
    // since that access already implies some form of support (patron, gifted...).
    if (!asset.locked && !Auth.isConnected()) {
      actions.push({ id: "support", name: "Visit creator", icon: "fa-solid fa-hands-praying", successMessage: "Opened the creator's page in a new tab." });
    }
    return actions;
  }

  private async resolveDownloadUrl(asset: MediaAsset): Promise<string> {
    const full = await MoulinetteClient.getAsset(asset.id);
    return `${full.base_url}/${full.file_url}`;
  }

  private sceneBackgroundCache = new Map<string, Promise<{ url: string; isVideo: boolean } | null>>();

  /**
   * A Scene's `file_url` looks like it should be a huge FoundryVTT scene
   * document (the asset's own `filesize` metadata says so), but what's actually
   * served there is a tiny standalone JSON with just the background
   * image/video reference (found by downloading one directly - a few hundred
   * bytes, not the tens of megabytes `filesize` suggests) - `background.src`,
   * prefixed with the same "#DEP#" placeholder the FoundryVTT module resolves
   * against the asset's own `deps` list. Cached per asset id: this is called
   * both eagerly (resolveMediaKind(), to badge/gate the card right after it's
   * rendered) and again on demand (add/download/preview), and there's no
   * reason to hit the network twice for the same asset.
   */
  private resolveSceneBackground(asset: MediaAsset): Promise<{ url: string; isVideo: boolean } | null> {
    let promise = this.sceneBackgroundCache.get(asset.id);
    if (!promise) {
      promise = (async () => {
        const full = await MoulinetteClient.getAsset(asset.id);
        const sceneUrl = `${full.base_url}/${full.file_url}`;
        let sceneDoc: any;
        try {
          sceneDoc = await fetch(sceneUrl).then((r) => r.json());
        } catch (e) {
          console.error(`Moulinette | Failed to download/parse scene JSON for asset ${asset.id}`, describeError(e));
          return null;
        }

        // Foundry moved the scene background from a plain top-level "img"
        // string (v9 and earlier) to a "background: { src }" object (v10+) -
        // Moulinette's catalog has content exported from both eras.
        const src: string | undefined = sceneDoc?.background?.src ?? sceneDoc?.img;
        if (!src) {
          console.error(`Moulinette | Scene ${asset.id} has neither background.src nor img`, sceneDoc);
          return null;
        }

        const depFilename = src.startsWith("#DEP#") ? src.slice("#DEP#".length) : src;
        const dep: string | undefined = (full.deps as string[] | undefined)?.find((d) => d.startsWith(depFilename));
        if (!dep) {
          console.error(`Moulinette | Scene ${asset.id}: no dependency matching "${depFilename}" in`, full.deps);
          return null;
        }

        const ext = dep.split("?")[0].split(".").pop()?.toLowerCase();
        const isVideo = !!ext && ["mp4", "webm", "mov", "m4v"].includes(ext);
        return { url: `${full.base_url}/${dep}`, isVideo };
      })();
      this.sceneBackgroundCache.set(asset.id, promise);
    }
    return promise;
  }

  /** Audio's `previewUrl` is only a lightweight sample clip - "Play" needs the real asset. */
  async getPlaybackUrl(asset: MediaAsset): Promise<string> {
    if (asset.type !== AssetType.Audio) return asset.previewUrl;
    return this.resolveDownloadUrl(asset);
  }

  /** `previewUrl` is only thumbnail quality - the in-app preview overlay wants the real, full-resolution asset. */
  async getPreviewUrl(asset: MediaAsset): Promise<string> {
    if (asset.flags.isScene) {
      const bg = await this.resolveSceneBackground(asset);
      return bg?.url ?? asset.previewUrl;
    }
    return this.resolveDownloadUrl(asset);
  }

  async resolveMediaKind(asset: MediaAsset): Promise<{ animated: boolean } | null> {
    if (!asset.flags.isScene) return null;
    const bg = await this.resolveSceneBackground(asset);
    return bg ? { animated: bg.isVideo } : null;
  }

  async executeAction(actionId: string, asset: MediaAsset): Promise<void> {
    switch (actionId) {
      case "add": {
        let url: string;
        if (asset.flags.isScene) {
          const bg = await this.resolveSceneBackground(asset);
          if (!bg) throw new Error("Could not resolve this scene's background image.");
          if (bg.isVideo) throw new Error("Animated maps can't be added to the scene - use Download to save the video file instead.");
          url = bg.url;
        } else {
          url = await this.resolveDownloadUrl(asset);
        }
        // Not addImageToScene(url, ...): that URL is signed with a short-lived
        // SAS token (an hour or so) - baking it straight into a scene item would
        // work today and quietly break for everyone once the token expires.
        // Downloading the actual bytes once, now, and handing them to Owlbear's
        // asset library instead gives the item a URL Owlbear hosts permanently.
        const blob = await fetch(url).then((r) => r.blob());
        await uploadImageToScene(blob, {
          name: asset.name,
          isMap: asset.type === AssetType.Map,
          typeHint: asset.type === AssetType.Map ? "MAP" : "PROP",
          sourceUrl: url,
        });
        break;
      }
      case "download": {
        // Some assets are served with a download disposition rather than
        // rendering inline in a new tab - fine (expected, even) for "Download".
        // For an animated map this deliberately gives the real .mp4/.webm file
        // (Owlbear can't use it as a scene image, but the GM can still want the
        // actual video), unlike "add"/"preview" which fall back to the static
        // thumbnail for those.
        let url: string;
        if (asset.flags.isScene) {
          const bg = await this.resolveSceneBackground(asset);
          url = bg?.url ?? asset.previewUrl;
        } else {
          url = await this.resolveDownloadUrl(asset);
        }
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
