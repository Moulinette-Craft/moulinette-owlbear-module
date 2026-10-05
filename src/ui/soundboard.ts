import { MoulinetteClient } from "../clients/moulinette";
import { MOU_STORAGE } from "../constants";
import { AudioBridgeMessage, openAudioChannel } from "../audioBridge";
import { getSoundboardLoops, setSoundboardLoops } from "../storage";
import { debounce, escapeHtml, matchesSearchTerm, prettyDuration } from "../utils";

/**
 * Ported from the real Moulinette SoundPads app (MouSoundPads in
 * moulinette-audio-foundryvtt-module/src/ts/apps/soundpads.ts, a docked,
 * full-height FoundryVTT ApplicationV2 window) rather than guessed from a
 * screenshot: same `/soundpads/sounds/:creator` one-shot API (one request per
 * creator instead of paging through the generic catalog search), same
 * CREATORS id->display-name map, same two groupings - a single-select
 * category filter from each sound's own `audio.categ` tags, and a folder
 * list keyed by the *last* path segment of each sound's filepath (not pack
 * name or the full subfolder chain).
 *
 * What's intentionally different from the FoundryVTT app:
 *  - Docked to the right, not the left - this sits inside a single modal that
 *    already has its own filters sidebar on the left (see browser.ts).
 *  - No "channel" control - that's FoundryVTT's own Music/Environment/
 *    Interface audio-channel routing, which Owlbear has no equivalent of.
 *  - No per-sound hide/show (right-click) - a real feature of the original
 *    but adds significant complexity for a first pass; can be added later.
 *  - Clicking a sound plays it through the "soundboard" group of
 *    src/audioBridge.ts (any number of tracks at once, locally only, kept
 *    alive by the toolbar popover so it survives this modal closing) instead
 *    of importing into a FoundryVTT Playlist, since Owlbear has no shared
 *    soundboard/playlist system to import into (see the project README).
 */
const CREATORS: Record<string, string> = {
  tabletopaudio: "Tabletop Audio",
  michaelghelfi: "Michael Ghelfi",
};

interface RawSoundpadAsset {
  filepath: string;
  uri: string;
  order?: number;
  pack: { pack_ref: string | number; creator_ref: string; path: string };
  audio?: { title?: string; categ?: string[]; duration?: number };
}

interface Sound {
  id: string;
  name: string;
  order: number;
  categories: string[]; // lowercased
  folder: string;
  duration?: number;
  url: string;
  /** Default looping - mirrors the FVTT app's own rule (see e.g. MouSoundPads._onPlaySound): no explicit metadata for this, a sound loops iff its filename contains "loop". The user can override it per sound, see isLooping(). */
  loop: boolean;
  /** Short name shown when listed as one version among its parent's variants - the text in parentheses of its name, e.g. "Tavern (Ambience Only)" -> "Ambience Only". */
  variantLabel: string;
  /** Alternate versions of this music (e.g. "ambience only"), see attachAlternates(). */
  variants?: Sound[];
}

/** Mirrors MouSoundPads.generateSoundAltHTML() - an alternate is labelled by the text in parentheses of its name, falling back to the whole name. */
function variantLabel(name: string): string {
  const match = /\(([^)]+)\)/.exec(name);
  return match ? match[1] : name;
}

/** Mirrors MouSoundPads.cleanSoundName() - turns a bare filename into a readable title when the asset has no explicit audio.title. */
function cleanSoundName(filename: string): string {
  const stripped = filename
    .split(".ogg")
    .join("")
    .split(".mp3")
    .join("")
    .split("loop")
    .join("")
    .split("_")
    .join(" ")
    .split("-")
    .join(" ")
    .replace("/", " / ");
  return stripped
    .split(" ")
    .map((w: string) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
    .trim();
}

/** Mirrors MouSoundpadUtils.foldersFromIndex(files, lastFolderOnly=true) - groups by the last path segment of the containing folder. Root-level files (no folder at all) return null - those are alternates of a named sound instead, see attachAlternates(). */
function lastFolderSegment(filepath: string): string | null {
  const idx = filepath.lastIndexOf("/");
  if (idx < 0) return null;
  const parent = filepath.substring(0, idx);
  const segment = parent.split("/").pop();
  return segment && segment.length > 0 ? segment : null;
}

export class SoundboardPanel {
  private container: HTMLElement;
  private audioChannel = openAudioChannel();
  private loaded = false;
  private loading = false;
  private loadError: string | null = null;

  private soundsByCreator = new Map<string, Sound[]>();
  private activeCreator: string | null = null;
  /** Single-select, like the real app's `.categories a` toggle - not a multi-select checkbox list. */
  private activeCategory: string | null = null;
  private expandedFolders = new Set<string>();
  /** Sound ids whose alternate versions are currently listed. */
  private expandedVariants = new Set<string>();
  private searchTerm = "";
  private globalVolume = 1;
  /** User overrides of Sound.loop, persisted across sessions (only entries differing from the default are kept). */
  private loopOverrides = getSoundboardLoops();

  /** assetId (Sound.id) -> current volume, mirrors the host's own soundboard state. */
  private playing = new Map<string, number>();
  /**
   * Locks onto whichever host instance's "state" we see first (see the
   * `hostId` doc comment in audioBridge.ts) and ignores every other one for
   * the rest of this panel's lifetime. Owlbear is only ever supposed to have
   * one popover iframe alive at a time, but if that ever doesn't hold, two
   * independent hosts would both react to every command - one's playback
   * succeeding while the other's fails, each broadcasting a different answer
   * for the same assetId within milliseconds of each other. Without this
   * lock, whichever one happened to broadcast last would win, flipping the
   * just-pressed play button back to "not playing" (and making "stop" a
   * no-op, since there'd be nothing in `this.playing` left to stop) while
   * the sound keeps audibly playing from the other, un-tracked instance.
   */
  private lockedHostId: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.audioChannel.onmessage = (event: MessageEvent<AudioBridgeMessage>) => {
      if (event.data.type !== "state") return;
      // Defensive: a stale toolbar-popover bundle (see src/action.ts - it can
      // outlive a source update, since Owlbear keeps that iframe loaded rather
      // than reloading it per click) could still be broadcasting the older,
      // single-slot "state" shape with no `soundboard`/`hostId` fields at
      // all, which would otherwise throw here and silently stop all future
      // state syncs.
      if (!Array.isArray(event.data.soundboard) || typeof event.data.hostId !== "string") {
        console.error("Moulinette | Soundboard: got a \"state\" message with an unexpected shape - the toolbar popover may be running stale code; try removing and re-adding the extension.", event.data);
        return;
      }
      if (this.lockedHostId === null) {
        this.lockedHostId = event.data.hostId;
        console.log(`Moulinette | Soundboard: locked onto host ${event.data.hostId}`);
      } else if (event.data.hostId !== this.lockedHostId) {
        // Temporary diagnostic - if this ever logs, it proves two host
        // instances are genuinely both alive in the same room session (not
        // just suspected) and confirms this ignoring is doing real work.
        console.warn(`Moulinette | Soundboard: ignoring "state" from a different host (${event.data.hostId}, locked onto ${this.lockedHostId})`, event.data);
        return;
      }
      this.playing = new Map(event.data.soundboard.map((s) => [s.assetId, s.volume]));
      this.updateTrackButtons();
    };
  }

  /** Call whenever the panel becomes visible (browser.ts owns the actual show/hide of the docked container itself - see toggleSoundboard()). */
  async open(): Promise<void> {
    this.audioChannel.postMessage({ type: "get-state" } satisfies AudioBridgeMessage);
    if (!this.loaded && !this.loading) {
      this.loading = true;
      this.renderShell();
      try {
        await this.loadAll();
        this.loaded = true;
      } catch (e) {
        console.error("Moulinette | Soundboard: failed to load", e);
        this.loadError = "Could not load the soundboard - check your connection and try reopening it.";
      } finally {
        this.loading = false;
        this.renderShell();
      }
    }
  }

  private async loadAll(): Promise<void> {
    for (const key of Object.keys(CREATORS)) {
      try {
        const sounds = await this.loadCreator(key);
        if (sounds.length > 0) this.soundsByCreator.set(key, sounds);
      } catch (e) {
        // One creator's catalog failing to load (network hiccup, etc.) shouldn't
        // take down the whole panel if the other one is still reachable.
        console.error(`Moulinette | Soundboard: failed to load ${CREATORS[key]}`, e);
      }
    }
    this.activeCreator = [...this.soundsByCreator.keys()][0] ?? null;
  }

  private async loadCreator(key: string): Promise<Sound[]> {
    const raw = (await MoulinetteClient.getSoundpadSounds(CREATORS[key])) as RawSoundpadAsset[];
    const sounds: { sound: Sound; filepath: string }[] = [];
    const alternates: { sound: Sound; filepath: string }[] = [];
    for (const r of raw) {
      const folder = lastFolderSegment(r.filepath);
      const name = r.audio?.title || cleanSoundName(r.filepath.split("/").pop() || r.filepath);
      const sound: Sound = {
        id: `${r.pack.pack_ref}/${r.filepath}`,
        name,
        order: r.order ?? 0,
        categories: (r.audio?.categ ?? []).map((c) => c.toLowerCase()),
        folder: folder ?? "",
        duration: r.audio?.duration,
        url: `${MOU_STORAGE}${r.pack.creator_ref}/${r.pack.path}/${r.uri}`,
        loop: r.filepath.toLowerCase().includes("loop"),
        variantLabel: variantLabel(name),
      };
      // root-level file, no named group to show it under => alternate version of another sound
      (folder ? sounds : alternates).push({ sound, filepath: r.filepath });
    }
    SoundboardPanel.attachAlternates(sounds, alternates);
    return sounds.map((s) => s.sound);
  }

  /**
   * Mirrors MouSoundPads._prepareContext(): root-level files are alternate
   * versions of a music (e.g. "ambience only"), matched to the first sound of
   * each folder whose filename shares the same prefix up to the first "_"
   * (`tavern_ambience.ogg` -> `.../Taverns/tavern_full.ogg`). Unmatched ones
   * are dropped, same as the original.
   */
  private static attachAlternates(sounds: { sound: Sound; filepath: string }[], alternates: { sound: Sound; filepath: string }[]): void {
    const byFolder = new Map<string, { sound: Sound; filepath: string }[]>();
    for (const s of sounds) {
      if (!byFolder.has(s.sound.folder)) byFolder.set(s.sound.folder, []);
      byFolder.get(s.sound.folder)!.push(s);
    }
    for (const alt of alternates) {
      const idx = alt.filepath.indexOf("_");
      if (idx <= 0) continue;
      const prefix = alt.filepath.substring(0, idx);
      for (const folderSounds of byFolder.values()) {
        const match = folderSounds.find((s) => s.filepath.includes(`/${prefix}_`));
        if (match) (match.sound.variants ??= []).push(alt.sound);
      }
    }
  }

  // ------------------------------------------------------------- shell --

  /** Toolbar (creator tabs, search box, category filter) + footer - rebuilt only when the creator/dataset changes, not on every search keystroke, so the search input never loses focus while typing. */
  private renderShell(): void {
    if (this.loading) {
      this.container.innerHTML = `<div class="mou-sb-status">Loading the soundboard…</div>`;
      return;
    }
    if (this.loadError) {
      this.container.innerHTML = `<div class="mou-sb-status mou-sb-error">${escapeHtml(this.loadError)}</div>`;
      return;
    }
    if (this.soundsByCreator.size === 0) {
      this.container.innerHTML = `<div class="mou-sb-status">No Tabletop Audio or Michael Ghelfi sounds found on your account.</div>`;
      return;
    }

    const creatorKeys = [...this.soundsByCreator.keys()];
    this.container.innerHTML = `
      <div class="mou-sb-creators">
        ${creatorKeys
          .map((key) => `<button class="mou-sb-creator-tab${key === this.activeCreator ? " mou-sb-creator-active" : ""}" data-creator="${key}">${escapeHtml(CREATORS[key])}</button>`)
          .join("")}
      </div>
      <div class="mou-sb-toolbar">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input id="mou-sb-search" type="search" placeholder="Filter sounds…" autocomplete="off" value="${escapeHtml(this.searchTerm)}" />
      </div>
      <div class="mou-sb-categories" id="mou-sb-categories"></div>
      <div class="mou-sb-results" id="mou-sb-results"></div>
      <div class="mou-sb-footer">
        <button class="mou-btn" id="mou-sb-stopall" title="Stop every playing sound"><i class="fa-solid fa-stop"></i></button>
        <span class="mou-sb-volume-label"><i class="fa-solid fa-volume-high"></i></span>
        <input id="mou-sb-global-volume" type="range" min="0" max="1" step="0.05" value="${this.globalVolume}" title="Volume" />
      </div>
    `;

    this.container.querySelectorAll<HTMLButtonElement>(".mou-sb-creator-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        this.activeCreator = tab.dataset.creator!;
        this.activeCategory = null;
        this.expandedFolders.clear();
        this.expandedVariants.clear();
        this.searchTerm = "";
        this.renderShell();
      });
    });

    const search = this.container.querySelector<HTMLInputElement>("#mou-sb-search")!;
    const applySearch = debounce(() => {
      this.searchTerm = search.value;
      this.renderResults();
    }, 200);
    search.addEventListener("input", applySearch);

    this.container.querySelector("#mou-sb-stopall")!.addEventListener("click", () => {
      for (const assetId of this.playing.keys()) {
        this.audioChannel.postMessage({ type: "stop", group: "soundboard", assetId } satisfies AudioBridgeMessage);
      }
      this.playing.clear();
      this.updateTrackButtons();
    });

    const globalVolume = this.container.querySelector<HTMLInputElement>("#mou-sb-global-volume")!;
    const applyVolume = debounce(() => {
      this.globalVolume = Number(globalVolume.value);
      for (const assetId of this.playing.keys()) {
        this.audioChannel.postMessage({ type: "set-volume", group: "soundboard", assetId, volume: this.globalVolume } satisfies AudioBridgeMessage);
      }
    }, 80);
    globalVolume.addEventListener("input", applyVolume);

    this.renderCategories();
    this.renderResults();
  }

  private renderCategories(): void {
    const container = this.container.querySelector<HTMLElement>("#mou-sb-categories");
    if (!container) return;
    const sounds = this.soundsByCreator.get(this.activeCreator ?? "") ?? [];
    const categories = [...new Set(sounds.flatMap((s) => s.categories))].sort();
    if (categories.length === 0) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = categories
      .map(
        (c) =>
          `<button class="mou-sb-category${c === this.activeCategory ? " mou-sb-category-active" : ""}" data-category="${escapeHtml(c)}"><i class="fa-solid fa-filter fa-xs"></i> ${escapeHtml(c)}</button>`,
      )
      .join("");

    container.querySelectorAll<HTMLButtonElement>(".mou-sb-category").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = btn.dataset.category!;
        this.activeCategory = this.activeCategory === c ? null : c;
        this.renderCategories();
        this.renderResults();
      });
    });
  }

  // ----------------------------------------------------------- results --

  private renderResults(): void {
    const container = this.container.querySelector<HTMLElement>("#mou-sb-results");
    if (!container) return;

    const sounds = this.soundsByCreator.get(this.activeCreator ?? "") ?? [];
    const term = this.searchTerm.trim();
    // Variants matching the search (e.g. "ambience") also bring up their
    // parent, auto-expanded so that it's obvious why it's listed.
    const matchedViaVariant = new Set<string>();
    const visible = sounds.filter((s) => {
      if (this.activeCategory && !s.categories.includes(this.activeCategory)) return false;
      if (term && !matchesSearchTerm(s.name, term)) {
        if (!s.variants?.some((v) => matchesSearchTerm(v.name, term))) return false;
        matchedViaVariant.add(s.id);
      }
      return true;
    });

    if (visible.length === 0) {
      container.innerHTML = `<div class="mou-sb-status">No sounds match.</div>`;
      return;
    }

    const folders = new Map<string, Sound[]>();
    for (const s of visible) {
      if (!folders.has(s.folder)) folders.set(s.folder, []);
      folders.get(s.folder)!.push(s);
    }
    const folderNames = [...folders.keys()].sort((a, b) => a.localeCompare(b));

    container.innerHTML = folderNames
      .map((folder) => {
        const items = folders.get(folder)!.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.name.localeCompare(b.name)));
        // Searching auto-expands matches, same as the original app - a plain
        // category filter doesn't (it only narrows what's already open/closed).
        const expanded = !!term || this.expandedFolders.has(folder);
        return `
        <div class="mou-sb-group">
          <button class="mou-sb-group-header" data-folder="${escapeHtml(folder)}">
            <i class="fa-solid ${expanded ? "fa-folder-open" : "fa-folder"}"></i>
            <span class="mou-sb-group-name">${escapeHtml(folder)}</span>
            <span class="mou-sb-group-count">${items.length}</span>
          </button>
          ${expanded ? `<div class="mou-sb-tracks">${items.map((s) => this.renderTrackRow(s, matchedViaVariant.has(s.id))).join("")}</div>` : ""}
        </div>`;
      })
      .join("");

    container.querySelectorAll<HTMLButtonElement>(".mou-sb-group-header").forEach((header) => {
      header.addEventListener("click", () => {
        const folder = header.dataset.folder!;
        if (this.expandedFolders.has(folder)) this.expandedFolders.delete(folder);
        else this.expandedFolders.add(folder);
        this.renderResults();
      });
    });

    container.querySelectorAll<HTMLElement>(".mou-sb-track").forEach((row) => this.wireTrackRow(row));
    this.updateTrackButtons();
  }

  private renderTrackRow(s: Sound, forceExpandVariants = false): string {
    if (!s.variants?.length) return this.renderPlayableRow(s, s.name, "");

    // Like the original app, a music with alternates isn't played directly:
    // clicking it lists every version (itself first, then its alternates).
    const expanded = forceExpandVariants || this.expandedVariants.has(s.id);
    const versions = [s, ...s.variants];
    return `
      <div class="mou-sb-track mou-sb-track-parent" data-id="${escapeHtml(s.id)}" title="${versions.length} versions">
        <button class="mou-sb-play mou-sb-expand" title="Show / hide versions"><i class="fa-solid ${expanded ? "fa-angles-up" : "fa-angles-down"}"></i></button>
        <span class="mou-sb-track-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
        <span class="mou-sb-track-versions">${versions.length}</span>
        ${s.duration ? `<span class="mou-sb-track-duration">${escapeHtml(prettyDuration(s.duration))}</span>` : ""}
      </div>
      ${expanded ? versions.map((v) => this.renderPlayableRow(v, v.variantLabel, " mou-sb-track-variant")).join("") : ""}
    `;
  }

  private renderPlayableRow(s: Sound, label: string, extraClass: string): string {
    const duration = s.duration ? prettyDuration(s.duration) : "";
    const loop = this.isLooping(s);
    return `
      <div class="mou-sb-track${extraClass}" data-id="${escapeHtml(s.id)}">
        <button class="mou-sb-play" title="Play / stop"><i class="fa-solid fa-play"></i></button>
        <span class="mou-sb-track-name" title="${escapeHtml(s.name)}">${escapeHtml(label)}</span>
        <button class="mou-sb-loop${loop ? " mou-sb-loop-active" : ""}" title="${loop ? "Loop on - click to play once" : "Loop off - click to loop"}"><i class="fa-solid fa-rotate"></i></button>
        ${duration ? `<span class="mou-sb-track-duration">${escapeHtml(duration)}</span>` : ""}
      </div>
    `;
  }

  private isLooping(s: Sound): boolean {
    return this.loopOverrides[s.id] ?? s.loop;
  }

  private toggleLoop(s: Sound, button: HTMLButtonElement): void {
    const loop = !this.isLooping(s);
    if (loop === s.loop) delete this.loopOverrides[s.id];
    else this.loopOverrides[s.id] = loop;
    setSoundboardLoops(this.loopOverrides);
    if (this.playing.has(s.id)) {
      this.audioChannel.postMessage({ type: "set-loop", group: "soundboard", assetId: s.id, loop } satisfies AudioBridgeMessage);
    }
    // the same sound can be listed twice (e.g. in two folders), keep every copy in sync
    this.container.querySelectorAll<HTMLElement>(".mou-sb-track:not(.mou-sb-track-parent)").forEach((row) => {
      if (row.dataset.id !== s.id) return;
      const btn = row.querySelector<HTMLButtonElement>(".mou-sb-loop");
      if (!btn) return;
      btn.classList.toggle("mou-sb-loop-active", loop);
      btn.title = loop ? "Loop on - click to play once" : "Loop off - click to loop";
    });
    button.blur();
  }

  private wireTrackRow(row: HTMLElement): void {
    const id = row.dataset.id!;
    const sound = this.findSound(id);
    if (!sound) return;

    if (row.classList.contains("mou-sb-track-parent")) {
      row.addEventListener("click", () => {
        if (this.expandedVariants.has(id)) this.expandedVariants.delete(id);
        else this.expandedVariants.add(id);
        this.renderResults();
      });
      this.wirePreview(row, id, sound);
      return;
    }

    const playBtn = row.querySelector<HTMLButtonElement>(".mou-sb-play")!;
    playBtn.addEventListener("click", () => {
      // Updated locally right away (same pattern as the main grid's preview
      // button in browser.ts's togglePlay()) instead of waiting on the "state"
      // broadcast round-trip from the toolbar popover - otherwise a second
      // click before that round-trip lands still sees `this.playing` as empty
      // and sends another "play" instead of "stop", stacking a second
      // overlapping instance of the same sound with no visible way to stop it.
      if (this.playing.has(id)) {
        this.playing.delete(id);
        this.audioChannel.postMessage({ type: "stop", group: "soundboard", assetId: id } satisfies AudioBridgeMessage);
      } else {
        this.playing.set(id, this.globalVolume);
        this.audioChannel.postMessage({ type: "play", group: "soundboard", assetId: id, url: sound.url, volume: this.globalVolume, loop: this.isLooping(sound) } satisfies AudioBridgeMessage);
      }
      this.updateTrackButtons();
    });

    const loopBtn = row.querySelector<HTMLButtonElement>(".mou-sb-loop")!;
    loopBtn.addEventListener("click", () => this.toggleLoop(sound, loopBtn));

    this.wirePreview(row, id, sound);
  }

  private wirePreview(row: HTMLElement, id: string, sound: Sound): void {
    // A short delayed hover preview, like the original app's mouseenter/mouseleave
    // handling - uses the exclusive "preview" group so it never fights with, or
    // gets fought by, whatever's already committed to the soundboard. Scoped as
    // a local (not a `this` field): each row needs its own pending timer, since
    // a shared one would be overwritten by the next row hovered before the
    // first one's 800ms elapses, leaking an uncancellable stray preview.
    let previewTimeout: ReturnType<typeof setTimeout> | undefined;
    row.addEventListener("mouseenter", () => {
      previewTimeout = setTimeout(() => {
        // Checked again here, not just when the timer was armed: the mouse is
        // typically still resting on the row right when its play button gets
        // clicked, so the timer is already ticking from *before* that click -
        // without re-checking at fire time, it goes on to start a second,
        // overlapping instance of the same file ~800ms after the click.
        if (this.playing.has(id)) return;
        this.audioChannel.postMessage({ type: "play", group: "preview", assetId: `preview:${id}`, url: sound.url } satisfies AudioBridgeMessage);
      }, 800);
    });
    row.addEventListener("mouseleave", () => {
      clearTimeout(previewTimeout);
      this.audioChannel.postMessage({ type: "stop", group: "preview", assetId: `preview:${id}` } satisfies AudioBridgeMessage);
    });
  }

  private findSound(id: string): Sound | undefined {
    for (const sounds of this.soundsByCreator.values()) {
      for (const s of sounds) {
        if (s.id === id) return s;
        const variant = s.variants?.find((v) => v.id === id);
        if (variant) return variant;
      }
    }
    return undefined;
  }

  private updateTrackButtons(): void {
    this.container.querySelectorAll<HTMLElement>(".mou-sb-track").forEach((row) => {
      const id = row.dataset.id!;
      if (row.classList.contains("mou-sb-track-parent")) {
        // highlighted when any of its versions is playing, keeps its expand icon
        const sound = this.findSound(id);
        row.classList.toggle("mou-sb-playing", !!sound && [sound, ...(sound.variants ?? [])].some((v) => this.playing.has(v.id)));
        return;
      }
      const isPlaying = this.playing.has(id);
      row.classList.toggle("mou-sb-playing", isPlaying);
      const icon = row.querySelector<HTMLElement>(".mou-sb-play i");
      if (icon) icon.className = isPlaying ? "fa-solid fa-pause" : "fa-solid fa-play";
    });
  }
}
