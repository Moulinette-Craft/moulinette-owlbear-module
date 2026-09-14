/**
 * Core abstractions of the extension, closely modeled on the "Collection" system of
 * the FoundryVTT Moulinette module (see apps/collection.ts there): every content
 * source (Moulinette Cloud, Game-icons.net, FontAwesome, BBC Sound Effects) plugs
 * into the browser UI through the same `MediaCollection` interface, which keeps the
 * UI itself completely source-agnostic.
 *
 * Compared to the FoundryVTT module, this only keeps the asset types that have a
 * real equivalent in Owlbear Rodeo: Owlbear has no compendiums, no local file
 * system access and no shared soundboard/playlist system, so Scenes, Actors,
 * Items, Journal Entries, Macros, RollTables, Adventures and PDFs are dropped.
 */

export enum AssetType {
  Map = "map",
  Image = "image",
  Icon = "icon",
  Audio = "audio",
}

export interface AssetMeta {
  icon?: string; // Font Awesome class, e.g. "fa-solid fa-stopwatch"
  text: string;
  hint: string;
}

export interface MediaAsset {
  id: string;
  type: AssetType;
  name: string;
  /** Full resolution / downloadable URL. For locked cloud previews this may be empty. */
  url: string;
  /** Thumbnail or waveform-preview URL used in the results grid. */
  previewUrl: string;
  creator?: string | null;
  creatorUrl?: string | null;
  pack?: string | null;
  packId?: string | null;
  width?: number;
  height?: number;
  /**
   * Font Awesome class to render as a live glyph (e.g. "fa-solid fa-dragon")
   * instead of an `<img>`. Only set by the Font Awesome collection - every other
   * source (including Game-icons.net) has a real image URL in `previewUrl` and
   * is rendered/dragged as a normal image.
   */
  iconGlyph?: string;
  meta: AssetMeta[];
  /** True when the asset can only be previewed and requires supporting the creator to use. */
  locked?: boolean;
  /** True when the asset is free to everyone regardless of membership. */
  free?: boolean;
  flags: Record<string, unknown>;
}

export interface SearchFilters {
  searchTerms: string;
  wholeWord: boolean;
  type: AssetType;
  creator: string; // "" = any
  pack: string; // "" = any
}

export interface Facet {
  id: string;
  name: string;
  count: number;
}

export interface SearchResults {
  assets: MediaAsset[];
  creators: Facet[];
  packs: Facet[];
  types: { type: AssetType; count: number }[];
}

export interface AssetAction {
  id: string;
  name: string;
  icon: string; // Font Awesome class
  primary?: boolean; // rendered larger / first
  /** Shown as an Owlbear notification once the action resolves successfully. Falls back to a generic "<name> done" message when omitted. */
  successMessage?: string;
}

export interface MediaCollection {
  id: string;
  name: string;
  description: string;
  supportedTypes: AssetType[];

  /** One-time (re)initialization, e.g. fetching the user's accessible asset list. */
  initialize(): Promise<void>;

  supportsType(type: AssetType): boolean;

  /** Whether the collection can be listed without typing a search term first. */
  isBrowsable(): boolean;

  /** Non-fatal error to surface in the UI (e.g. "can't reach game-icons.net"), if any. */
  getError(): string | null;

  search(filters: SearchFilters, page: number): Promise<SearchResults>;
  getAssetsCount(filters: SearchFilters): Promise<number>;

  getActions(asset: MediaAsset): AssetAction[];
  executeAction(actionId: string, asset: MediaAsset): Promise<void>;

  /**
   * Resolves the URL to actually stream for the "play" action. Defaults to
   * `asset.previewUrl` when not implemented; overridden by collections (like
   * Moulinette Cloud) whose `previewUrl` is a lightweight sample rather than the
   * real asset, and who need to resolve a signed download URL first.
   */
  getPlaybackUrl?(asset: MediaAsset): Promise<string>;

  /**
   * Resolves the URL to show full-size in the in-app "preview" overlay. Defaults
   * to `asset.previewUrl` (thumbnail quality) when not implemented; overridden by
   * Moulinette Cloud to resolve the real, full-resolution asset first.
   */
  getPreviewUrl?(asset: MediaAsset): Promise<string>;

  /**
   * For assets whose real underlying media can only be known by resolving them
   * (a Moulinette Cloud "Scene" asset's map could turn out to be a video rather
   * than an image) - called once, lazily, right after the asset's card is first
   * rendered, so the UI can show an accurate badge and gate actions (e.g. an
   * animated map can't be added to the scene) without paying for this
   * resolution on every asset up front. Returns null for assets this doesn't
   * apply to.
   */
  resolveMediaKind?(asset: MediaAsset): Promise<{ animated: boolean } | null>;
}
