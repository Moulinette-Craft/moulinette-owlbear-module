import { BBCSoundsClient } from "../clients/bbcsounds";
import { AssetAction, AssetType, MediaAsset, MediaCollection, SearchFilters, SearchResults } from "../types";
import { prettyDuration, prettyFilesize } from "../utils";

export class BBCSoundsCollection implements MediaCollection {
  id = "bbc-sounds";
  name = "BBC Sound Effects";
  description = "Free sound effects from the BBC, for non-commercial use. Played locally, in your own browser only.";
  supportedTypes = [AssetType.Audio];

  private lastCount = 0;
  private error: string | null = null;

  async initialize(): Promise<void> {
    this.error = null;
  }

  supportsType(type: AssetType): boolean {
    return type === AssetType.Audio;
  }

  isBrowsable(): boolean {
    return false;
  }

  getError(): string | null {
    return this.error;
  }

  async getAssetsCount(): Promise<number> {
    return this.lastCount;
  }

  async search(filters: SearchFilters, page: number): Promise<SearchResults> {
    if (filters.type !== AssetType.Audio || !filters.searchTerms || filters.searchTerms.trim().length < 3) {
      this.lastCount = 0;
      return { assets: [], creators: [], packs: [], types: [{ type: AssetType.Audio, count: 0 }] };
    }
    try {
      const { sounds, count } = await BBCSoundsClient.search(filters.searchTerms, page);
      this.lastCount = count;
      const assets: MediaAsset[] = sounds.map((s) => {
        const url = `https://sound-effects-media.bbcrewind.co.uk/mp3/${s.id}.mp3`;
        const meta: MediaAsset["meta"] = [];
        if (s.duration) meta.push({ icon: "fa-regular fa-stopwatch", text: prettyDuration(s.duration / 1000), hint: "Duration" });
        if (s.fileSizes?.mp3FileSize) {
          meta.push({ icon: "fa-solid fa-weight-hanging", text: prettyFilesize(s.fileSizes.mp3FileSize, 0), hint: "File size" });
        }
        return {
          id: s.id,
          type: AssetType.Audio,
          name: s.description,
          url,
          previewUrl: url,
          creator: `BBC Sound Effects (© BBC, bbc.co.uk)`,
          creatorUrl: "https://sound-effects.bbcrewind.co.uk",
          meta,
          flags: {},
        };
      });
      return { assets, creators: [], packs: [], types: [{ type: AssetType.Audio, count }] };
    } catch (e) {
      console.error("Moulinette | BBC Sound Effects search failed", e);
      this.error = "Could not reach BBC Sound Effects.";
      return { assets: [], creators: [], packs: [], types: [] };
    }
  }

  getActions(): AssetAction[] {
    return [
      { id: "play", name: "Play / stop", icon: "fa-solid fa-play-pause", primary: true },
      { id: "download", name: "Download", icon: "fa-solid fa-cloud-arrow-down" },
    ];
  }

  async executeAction(actionId: string, asset: MediaAsset): Promise<void> {
    if (actionId === "download") {
      window.open(asset.url, "_blank");
    }
    // "play" is intercepted by the browser UI (shared <audio> element).
  }
}
