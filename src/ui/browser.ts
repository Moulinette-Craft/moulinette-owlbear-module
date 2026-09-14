import OBR from "@owlbear-rodeo/sdk";
import { AssetAction, AssetType, MediaAsset, MediaCollection, SearchFilters } from "../types";
import { CloudCollection } from "../collections/cloud";
import { GameIconsCollection } from "../collections/gameicons";
// Font Awesome and BBC Sound Effects are temporarily disabled (not removed - the
// collection files are untouched, just not registered below) at the user's
// request, to keep the surface area small while debugging. Re-enable by
// uncommenting the imports and the two entries in the constructor below.
// import { FontAwesomeCollection } from "../collections/fontawesome";
// import { BBCSoundsCollection } from "../collections/bbcsounds";
import { Auth } from "../auth";
import { getAdvancedSettings, getLastSearch, setAdvancedSettings, setLastSearch } from "../storage";
import { debounce, escapeHtml, prettyNumber } from "../utils";
import { MODAL_ID } from "../constants";
import { describeError } from "../debug";

const TYPE_LABELS: Record<AssetType, { label: string; icon: string }> = {
  [AssetType.Map]: { label: "Maps", icon: "fa-solid fa-map" },
  [AssetType.Image]: { label: "Images", icon: "fa-solid fa-image" },
  [AssetType.Icon]: { label: "Icons", icon: "fa-solid fa-icons" },
  [AssetType.Audio]: { label: "Sounds", icon: "fa-solid fa-music" },
};

export class MoulinetteBrowser {
  private root: HTMLElement;
  private collections: MediaCollection[];
  private cloudCollection: CloudCollection;
  private collection: MediaCollection;
  private filters: SearchFilters = { searchTerms: "", wholeWord: false, type: AssetType.Map, creator: "", pack: "" };
  private page = 0;
  private loadedAssets: MediaAsset[] = [];
  private totalCount = 0;
  private loading = false;
  private noMore = false;
  private observer?: IntersectionObserver;
  private currentAudioAssetId: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.cloudCollection = new CloudCollection();
    this.collections = [this.cloudCollection, new GameIconsCollection()];
    this.collection = this.collections[0];
    this.filters.type = this.collection.supportedTypes[0];

    // Reopening the browser (it has no persistent state of its own - Owlbear
    // reloads this page fresh every time the modal opens) otherwise means
    // starting from scratch on every single search. Restore whatever
    // source/search/creator/pack was last used instead, when it still applies.
    const saved = getLastSearch();
    const savedCollection = saved && this.collections.find((c) => c.id === saved.collectionId);
    if (saved && savedCollection) {
      this.collection = savedCollection;
      this.filters = savedCollection.supportedTypes.includes(saved.filters.type) ? saved.filters : { ...saved.filters, type: savedCollection.supportedTypes[0] };
    }
  }

  async mount(): Promise<void> {
    this.renderShell();
    await this.refreshAccountWidget();
    await this.selectCollection(this.collection.id, /*initial*/ true);
  }

  // ---------------------------------------------------------------- shell --

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="mou-app">
        <header class="mou-header">
          <div class="mou-brand"><img class="mou-logo" src="icon.svg" alt="" /> Moulinette Media Search</div>
          <div class="mou-header-right">
            <div class="mou-account" id="mou-account"></div>
            <button class="mou-btn mou-close" id="mou-close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </header>
        <div class="mou-body">
          <aside class="mou-sidebar">
            <section class="mou-filter-group">
              <h2>Source</h2>
              <div id="mou-collections" class="mou-radio-list"></div>
            </section>
            <section class="mou-filter-group">
              <h2>Type</h2>
              <div id="mou-types" class="mou-radio-list"></div>
            </section>
            <section class="mou-filter-group" id="mou-facets"></section>
            <section class="mou-filter-group mou-advanced" id="mou-advanced-section">
              <h2>Advanced settings</h2>
              <div id="mou-advanced"></div>
            </section>
          </aside>
          <main class="mou-content">
            <div class="mou-search-bar">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input id="mou-search" type="search" placeholder="Search…" autocomplete="off" value="${escapeHtml(this.filters.searchTerms)}" />
              <label class="mou-wholeword" title="Match whole words only">
                <input id="mou-wholeword" type="checkbox" ${this.filters.wholeWord ? "checked" : ""} /> Whole word
              </label>
              <span class="mou-count" id="mou-count"></span>
            </div>
            <div class="mou-error" id="mou-error" hidden></div>
            <div class="mou-results" id="mou-results"></div>
            <div class="mou-sentinel" id="mou-sentinel"></div>
          </main>
        </div>
        <audio id="mou-audio"></audio>
      </div>
    `;

    const search = this.el<HTMLInputElement>("#mou-search");
    const performSearch = () => {
      this.filters.searchTerms = search.value;
      this.runSearch();
    };
    search.addEventListener("input", debounce(performSearch, 500));
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") performSearch();
    });
    search.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      search.value = "";
      this.filters.searchTerms = "";
      this.runSearch();
    });

    this.el<HTMLInputElement>("#mou-wholeword").addEventListener("change", (e) => {
      this.filters.wholeWord = (e.target as HTMLInputElement).checked;
      this.runSearch();
    });

    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this.loadMore();
    });
    this.observer.observe(this.el("#mou-sentinel"));

    this.renderCollectionsList();
    this.renderAdvancedSettings();

    const audio = this.el<HTMLAudioElement>("#mou-audio");
    audio.addEventListener("ended", () => {
      this.currentAudioAssetId = null;
      this.updatePlayButtons();
    });

    // A fullScreen OBR.modal replaces the entire Owlbear UI with no host-provided
    // close button - without this, there would be no way back to the room at all.
    this.el("#mou-close").addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
  }

  private close(): void {
    OBR.modal.close(MODAL_ID);
  }

  private el<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector(selector) as T;
  }

  // ------------------------------------------------------------ account --

  private renderConnectButtons(container: HTMLElement): void {
    // Discord sign-in is temporarily removed from the UI (not removed from
    // auth.ts - still there to bring back with one line if wanted later).
    container.innerHTML = `<button class="mou-btn mou-connect" data-source="patreon"><i class="fa-brands fa-patreon"></i> Connect Patreon</button>`;
    container.querySelectorAll<HTMLButtonElement>(".mou-connect").forEach((btn) => {
      btn.addEventListener("click", () => this.startLogin(btn.dataset.source as "patreon" | "discord"));
    });
  }

  private async refreshAccountWidget(): Promise<void> {
    const container = this.el("#mou-account");
    if (!Auth.isConnected()) {
      this.renderConnectButtons(container);
      return;
    }

    container.innerHTML = `<span class="mou-account-loading">Loading account…</span>`;
    const user = await Auth.getUser();
    if (!user || !user.fullName) {
      this.renderConnectButtons(container);
      return;
    }

    const status = user.patron ? `<i class="fa-solid fa-heart"></i> Patron` : user.platinum ? `<i class="fa-solid fa-heart"></i> Platinum patron` : "";
    container.innerHTML = `
      <span class="mou-account-name">${escapeHtml(String(user.fullName))}${status ? ` <span class="mou-patron">${status}</span>` : ""}</span>
      <button class="mou-btn mou-logout" title="Disconnect"><i class="fa-solid fa-sign-out-alt"></i></button>
    `;
    container.querySelector(".mou-logout")?.addEventListener("click", () => {
      Auth.disconnect();
      this.cloudCollection.invalidate();
      this.refreshAccountWidget();
      this.runSearch();
    });
  }

  private async startLogin(source: "patreon" | "discord"): Promise<void> {
    const container = this.el("#mou-account");
    container.innerHTML = `<span class="mou-account-loading">Waiting for sign-in… (<span id="mou-login-timer">120</span>s)</span>`;
    const ok = await Auth.connect(source, (secondsLeft) => {
      const el = this.root.querySelector("#mou-login-timer");
      if (el) el.textContent = String(secondsLeft);
    });
    if (ok) {
      this.cloudCollection.invalidate();
    }
    await this.refreshAccountWidget();
    if (ok) this.runSearch();
  }

  // -------------------------------------------------------------- filters --

  private renderCollectionsList(): void {
    const container = this.el("#mou-collections");
    container.innerHTML = this.collections
      .map(
        (c) => `
        <label class="mou-radio" title="${escapeHtml(c.description)}">
          <input type="radio" name="collection" value="${c.id}" ${c.id === this.collection.id ? "checked" : ""} />
          ${escapeHtml(c.name)}
        </label>`,
      )
      .join("");
    container.querySelectorAll<HTMLInputElement>("input[name=collection]").forEach((input) => {
      input.addEventListener("change", () => this.selectCollection(input.value));
    });
  }

  private renderTypesList(): void {
    const container = this.el("#mou-types");
    container.innerHTML = this.collection.supportedTypes
      .map((t) => {
        const info = TYPE_LABELS[t];
        return `
        <label class="mou-radio">
          <input type="radio" name="type" value="${t}" ${t === this.filters.type ? "checked" : ""} />
          <i class="${info.icon}"></i> ${info.label}
        </label>`;
      })
      .join("");
    container.querySelectorAll<HTMLInputElement>("input[name=type]").forEach((input) => {
      input.addEventListener("change", () => {
        this.filters.type = input.value as AssetType;
        this.filters.creator = "";
        this.filters.pack = "";
        this.runSearch();
      });
    });
  }

  private renderFacets(creators: { id: string; name: string; count: number }[], packs: { id: string; name: string; count: number }[]): void {
    const container = this.el("#mou-facets");
    if (creators.length === 0 && packs.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <h2>Filter</h2>
      ${
        creators.length > 0
          ? `<select id="mou-creator"><option value="">All creators</option>${creators
              .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === this.filters.creator ? "selected" : ""}>${escapeHtml(c.name)} (${prettyNumber(c.count, true)})</option>`)
              .join("")}</select>`
          : ""
      }
      ${
        packs.length > 0
          ? `<select id="mou-pack"><option value="">All packs</option>${packs
              .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === this.filters.pack ? "selected" : ""}>${escapeHtml(p.name)} (${prettyNumber(p.count, true)})</option>`)
              .join("")}</select>`
          : ""
      }
    `;
    const creatorSelect = this.root.querySelector<HTMLSelectElement>("#mou-creator");
    creatorSelect?.addEventListener("change", (e) => {
      this.filters.creator = (e.target as HTMLSelectElement).value;
      this.filters.pack = "";
      this.runSearch();
    });
    creatorSelect?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.filters.creator = "";
      this.filters.pack = "";
      this.runSearch();
    });
    const packSelect = this.root.querySelector<HTMLSelectElement>("#mou-pack");
    packSelect?.addEventListener("change", (e) => {
      this.filters.pack = (e.target as HTMLSelectElement).value;
      this.runSearch();
    });
    packSelect?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.filters.pack = "";
      this.runSearch();
    });
  }

  private renderAdvancedSettings(): void {
    // The icon color/background settings only affect collections that generate
    // (and recolor) their own icon images client-side - Moulinette Cloud has
    // nothing to do with them.
    const section = this.el("#mou-advanced-section");
    if (!this.collection.supportsType(AssetType.Icon)) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const settings = getAdvancedSettings();
    const container = this.el("#mou-advanced");
    container.innerHTML = `
      <label class="mou-field">
        Icon color
        <input id="mou-adv-fg" type="color" value="${settings.image.fgColor}" />
      </label>
      <label class="mou-field mou-checkbox">
        <input id="mou-adv-bg-enabled" type="checkbox" ${settings.image.bgColor ? "checked" : ""} />
        Icon background
        <input id="mou-adv-bg" type="color" value="${settings.image.bgColor || "#000000"}" ${settings.image.bgColor ? "" : "disabled"} />
      </label>
      <p class="mou-hint">Used when recoloring game-icons.net icons.</p>
    `;
    this.el<HTMLInputElement>("#mou-adv-fg").addEventListener("input", (e) => {
      const s = getAdvancedSettings();
      s.image.fgColor = (e.target as HTMLInputElement).value;
      setAdvancedSettings(s);
    });
    const bgEnabled = this.el<HTMLInputElement>("#mou-adv-bg-enabled");
    const bgColor = this.el<HTMLInputElement>("#mou-adv-bg");
    bgEnabled.addEventListener("change", () => {
      bgColor.disabled = !bgEnabled.checked;
      const s = getAdvancedSettings();
      s.image.bgColor = bgEnabled.checked ? bgColor.value : "";
      setAdvancedSettings(s);
    });
    bgColor.addEventListener("input", () => {
      const s = getAdvancedSettings();
      s.image.bgColor = bgColor.value;
      setAdvancedSettings(s);
    });
  }

  // --------------------------------------------------------------- search --

  private async selectCollection(id: string, initial = false): Promise<void> {
    const collection = this.collections.find((c) => c.id === id);
    if (!collection) return;
    this.collection = collection;
    if (!this.collection.supportedTypes.includes(this.filters.type)) {
      this.filters.type = this.collection.supportedTypes[0];
    }
    // Skipped on the initial (restored) load: the saved creator/pack are for
    // this very collection and still apply, whereas an actual user-driven
    // switch away from the current collection should drop them.
    if (!initial) {
      this.filters.creator = "";
      this.filters.pack = "";
      this.renderCollectionsList();
    }
    this.renderTypesList();
    this.renderAdvancedSettings();
    await this.runSearch();
  }

  /**
   * Always (re)runs `initialize()` before searching: cheap/idempotent for every
   * collection (each guards its own one-time work), and necessary so that
   * connecting/disconnecting the Moulinette account - which calls
   * `CloudCollection.invalidate()` - actually refetches on the next search
   * instead of silently searching an emptied asset list.
   */
  private async runSearch(): Promise<void> {
    this.page = 0;
    this.loadedAssets = [];
    this.noMore = false;
    const results = this.el("#mou-results");
    results.innerHTML = "";
    // Lets style.css size tiles differently per type (maps are wide/landscape and
    // benefit from a bigger tile than a square icon or image thumbnail does).
    results.dataset.type = this.filters.type;
    setLastSearch({ collectionId: this.collection.id, filters: this.filters });
    await this.collection.initialize();
    this.showError(this.collection.getError());
    await this.loadMore();
  }

  private showError(message: string | null): void {
    const el = this.el("#mou-error");
    if (message) {
      el.hidden = false;
      el.textContent = message;
    } else {
      el.hidden = true;
    }
  }

  private async loadMore(): Promise<void> {
    if (this.loading || this.noMore) return;
    this.loading = true;
    try {
      const results = await this.collection.search(this.filters, this.page);
      this.showError(this.collection.getError());

      if (this.page === 0) {
        this.totalCount = await this.collection.getAssetsCount(this.filters);
        this.renderFacets(results.creators, results.packs);
      }

      if (results.assets.length === 0) {
        this.noMore = true;
        if (this.page === 0) {
          const needsSearch = !this.collection.isBrowsable() && this.filters.searchTerms.trim().length < 3;
          this.el("#mou-results").innerHTML = `<div class="mou-empty">${
            needsSearch ? "Type at least 3 characters to search." : "No results found."
          }</div>`;
        }
        return;
      }

      this.page++;
      this.loadedAssets.push(...results.assets);
      this.appendAssets(results.assets);
      this.updateCount();
    } catch (e) {
      console.error("Moulinette | Search failed", e);
      this.showError("Something went wrong while loading results.");
      this.noMore = true;
    } finally {
      this.loading = false;
    }
  }

  private updateCount(): void {
    const el = this.el("#mou-count");
    el.textContent = this.totalCount > 0 ? `${prettyNumber(this.loadedAssets.length, true)} / ${prettyNumber(this.totalCount, true)}` : `${prettyNumber(this.loadedAssets.length, true)}`;
  }

  // --------------------------------------------------------------- assets --

  private appendAssets(assets: MediaAsset[]): void {
    const results = this.el("#mou-results");
    const frag = document.createDocumentFragment();
    for (const asset of assets) {
      frag.appendChild(this.renderAssetCard(asset));
    }
    results.appendChild(frag);
  }

  private renderAssetCard(asset: MediaAsset): HTMLElement {
    const card = document.createElement("div");
    card.className = "mou-asset";
    card.dataset.id = asset.id;

    const isAudio = asset.type === AssetType.Audio;

    const thumb = document.createElement("div");
    thumb.className = "mou-thumb";
    if (asset.iconGlyph) {
      // Font Awesome: rendered as a live glyph, since there's no image file to
      // point an <img> at until "Add to scene" rasterizes one on demand.
      const glyph = document.createElement("i");
      glyph.className = asset.iconGlyph;
      thumb.appendChild(glyph);
    } else if (isAudio) {
      thumb.innerHTML = `<i class="fa-solid fa-music"></i>`;
    } else {
      // A real <img>, not a CSS background, so the browser's own native drag
      // payload (the same one used when dragging an image out of any web page)
      // is what Owlbear Rodeo sees - it already knows how to turn that into a new
      // image item when dropped on the canvas, no extra wiring needed here. This
      // is an alternative to the explicit "Add to scene" button below.
      const img = document.createElement("img");
      img.src = asset.previewUrl;
      img.loading = "lazy";
      img.alt = asset.name;
      img.draggable = true;
      thumb.appendChild(img);
    }

    // "Scene" is known immediately (from the search result itself); "Animated"
    // can only be known by resolving the scene's actual background, so it's
    // added asynchronously below once that resolves.
    const badges = document.createElement("div");
    badges.className = "mou-badges";
    if (asset.flags.isScene) {
      badges.appendChild(this.createBadge("fa-solid fa-layer-group", "Scene", "A full FoundryVTT scene - its background image is used here."));
    }
    thumb.appendChild(badges);
    card.appendChild(thumb);

    const name = document.createElement("div");
    name.className = "mou-name";
    name.title = asset.name;
    name.textContent = asset.name;
    card.appendChild(name);

    if (asset.creator) {
      const creator = document.createElement("div");
      creator.className = "mou-creator";
      creator.textContent = asset.pack ? `${asset.creator} · ${asset.pack}` : asset.creator;
      card.appendChild(creator);
    }

    if (asset.meta.length > 0) {
      const meta = document.createElement("div");
      meta.className = "mou-meta";
      meta.innerHTML = asset.meta.map((m) => `<span title="${escapeHtml(m.hint)}">${m.icon ? `<i class="${m.icon}"></i> ` : ""}${escapeHtml(m.text)}</span>`).join("");
      card.appendChild(meta);
    }

    const actions = document.createElement("div");
    actions.className = "mou-actions";
    for (const action of this.collection.getActions(asset)) {
      const btn = document.createElement("button");
      btn.className = `mou-action-btn${action.primary ? " primary" : ""}`;
      btn.title = action.name;
      btn.dataset.actionId = action.id;
      btn.innerHTML = `<i class="${action.icon}"></i>`;
      btn.addEventListener("click", () => this.handleAction(action, asset, btn));
      actions.appendChild(btn);
    }
    card.appendChild(actions);

    if (asset.flags.isScene && this.collection.resolveMediaKind) {
      this.collection.resolveMediaKind(asset).then((kind) => {
        if (!kind?.animated) return;
        badges.appendChild(this.createBadge("fa-solid fa-film", "Animated", "This map has a video background - it can be downloaded, but not added to the scene."));
        // Owlbear scene images aren't video - there's nothing "add" could do here.
        actions.querySelector('[data-action-id="add"]')?.remove();
      });
    }

    return card;
  }

  private async handleAction(action: AssetAction, asset: MediaAsset, button: HTMLButtonElement): Promise<void> {
    const actionId = action.id;
    if (actionId === "browse-pack") {
      if (asset.creator) this.filters.creator = asset.creator;
      this.filters.pack = asset.packId || "";
      this.filters.searchTerms = "";
      this.el<HTMLInputElement>("#mou-search").value = "";
      await this.runSearch();
      return;
    }
    if (actionId === "play") {
      button.disabled = true;
      try {
        await this.togglePlay(asset);
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (actionId === "preview") {
      await this.openPreview(asset, button);
      return;
    }
    button.disabled = true;
    const icon = button.querySelector("i");
    const originalClass = icon?.className;
    if (icon) icon.className = "fa-solid fa-spinner fa-spin";
    try {
      await this.collection.executeAction(actionId, asset);
      if (typeof OBR !== "undefined") {
        OBR.notification.show(action.successMessage ?? `${action.name} - done.`, "SUCCESS");
      }
      // "add" either places the item straight away (Moulinette Cloud, at the
      // viewport's center) or hands off to Owlbear's own click-to-place flow
      // (game-icons/Font Awesome, via OBR.assets.uploadImages) - either way the
      // scene itself needs to be visible for the user to see the result or click
      // on it, which this fullscreen modal is currently covering entirely.
      if (actionId === "add") {
        this.close();
        return;
      }
    } catch (e) {
      console.error("[Moulinette] handleAction: action failed", actionId, describeError(e));
      if (typeof OBR !== "undefined") {
        OBR.notification.show("Moulinette: action failed - see console for details.", "ERROR");
      }
    } finally {
      button.disabled = false;
      if (icon && originalClass) icon.className = originalClass;
    }
  }

  private async togglePlay(asset: MediaAsset): Promise<void> {
    const audio = this.el<HTMLAudioElement>("#mou-audio");
    if (this.currentAudioAssetId === asset.id && !audio.paused) {
      audio.pause();
      this.currentAudioAssetId = null;
    } else {
      const url = this.collection.getPlaybackUrl ? await this.collection.getPlaybackUrl(asset) : asset.previewUrl;
      audio.src = url;
      await audio.play();
      this.currentAudioAssetId = asset.id;
    }
    this.updatePlayButtons();
  }

  private updatePlayButtons(): void {
    this.root.querySelectorAll<HTMLElement>(".mou-asset").forEach((card) => {
      const playing = card.dataset.id === this.currentAudioAssetId;
      card.classList.toggle("mou-playing", playing);
    });
  }

  private async openPreview(asset: MediaAsset, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const icon = button.querySelector("i");
    const originalClass = icon?.className;
    if (icon) icon.className = "fa-solid fa-spinner fa-spin";
    try {
      // Full resolution for collections that can resolve one (Moulinette Cloud);
      // falls back to the thumbnail for everything else.
      const url = this.collection.getPreviewUrl ? await this.collection.getPreviewUrl(asset) : asset.previewUrl;
      this.showLightbox(url, asset.name);
    } catch (e) {
      console.error("[Moulinette] openPreview: failed", describeError(e));
      if (typeof OBR !== "undefined") {
        OBR.notification.show("Moulinette: could not load the preview.", "ERROR");
      }
    } finally {
      button.disabled = false;
      if (icon && originalClass) icon.className = originalClass;
    }
  }

  /** Near-fullscreen in-app overlay, since some assets are served with a download
   * disposition and just open a file-save prompt instead of rendering when their
   * URL is opened directly in a new tab. */
  private showLightbox(url: string, name: string): void {
    const isVideo = ["mp4", "webm", "mov", "m4v"].includes(url.split("?")[0].split(".").pop()?.toLowerCase() ?? "");
    const overlay = document.createElement("div");
    overlay.className = "mou-lightbox";
    overlay.innerHTML = `
      <button class="mou-lightbox-close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
      ${isVideo ? `<video src="${url}" autoplay loop muted controls></video>` : `<img src="${url}" alt="${escapeHtml(name)}" />`}
    `;
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Clicking the backdrop closes it; clicking the image itself (a different
    // target than the overlay) does not, so an accidental click while looking
    // at the image doesn't dismiss it.
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".mou-lightbox-close")?.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
  }

  private createBadge(icon: string, label: string, hint: string): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "mou-badge";
    badge.title = hint;
    badge.innerHTML = `<i class="${icon}"></i> ${label}`;
    return badge;
  }
}
