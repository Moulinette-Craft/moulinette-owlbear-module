import OBR from "@owlbear-rodeo/sdk";
import { MODAL_ID } from "./constants";
import { AudioBridgeMessage, openAudioChannel } from "./audioBridge";

// A large fixed size rather than fullScreen: true - takes up a good part of the
// screen without covering the whole room. Owlbear's modal has no drag-to-resize
// handles of its own (there's no such option on the SDK's Modal type - width and
// height are the only size controls it exposes), so this is as close to
// "resizable" as the platform allows for a modal.
const MODAL_WIDTH = 1400;
const MODAL_HEIGHT = 900;

declare global {
  interface Window {
    __mouAudioHostInitialized?: boolean;
  }
}

interface PlayingTrack {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Owns every actual sound for sound-effect playback (see src/audioBridge.ts
 * for why it lives here rather than in the browser modal, and for the
 * "preview" vs "soundboard" group split) - relays play/stop/volume commands
 * from whichever modal instance is currently open, if any, and reports state
 * changes back so a (re)opened modal can show the right play/pause icons and
 * volume sliders for whatever's already playing.
 *
 * Built on the Web Audio API (fetch the file, decodeAudioData, play through
 * an AudioBufferSourceNode) rather than plain <audio>/`new Audio()` elements,
 * found necessary by testing: a fresh <audio>.play() call made from this
 * popover reliably rejected with "The fetching process for the media
 * resource was aborted by the user agent at the user's request" - Owlbear
 * keeps this popover at 1x1px and visually closed once the modal is open
 * (see OBR.action.close() below), and browsers suspend/abort a *new*
 * <audio>/<video> element's own media-fetch pipeline in that kind of
 * hidden/near-zero-size context as a background-tab/power-saving measure.
 * A plain fetch() feeding Web Audio API nodes isn't subject to that
 * <audio>-element-specific restriction, so it keeps working even while this
 * popover sits hidden - the standard workaround for background/hidden-frame
 * audio in games and ambient-sound apps generally.
 *
 * Guarded against running twice on the same page: if this module were ever
 * re-executed without a full page reload (e.g. a dev-server hot update that
 * doesn't tear down the previous instance), two independent BroadcastChannel
 * listeners would both react to every message, each playing/stopping its own
 * copy and broadcasting its own "state", with no way for a modal to tell
 * which one is authoritative (the client additionally guards against this by
 * locking onto whichever host's `hostId` it hears from first - see
 * browser.ts/soundboard.ts - in case two ever end up running anyway).
 */
function initAudioHost(): void {
  if (window.__mouAudioHostInitialized) return;
  window.__mouAudioHostInitialized = true;

  const channel = openAudioChannel();
  const hostId = crypto.randomUUID();
  console.log(`Moulinette | Audio host ${hostId} initialized`);

  const audioContext = new AudioContext();
  // Keyed by URL, not assetId: the same sample (e.g. a BBC preview clip) can
  // be requested more than once, and re-fetching/re-decoding it every time
  // would be wasteful.
  const bufferCache = new Map<string, Promise<AudioBuffer>>();

  const loadBuffer = (url: string): Promise<AudioBuffer> => {
    let promise = bufferCache.get(url);
    if (!promise) {
      promise = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => audioContext.decodeAudioData(data));
      // Don't poison the cache with a failed fetch/decode - let the next attempt retry.
      promise.catch(() => bufferCache.delete(url));
      bufferCache.set(url, promise);
    }
    return promise;
  };

  let previewAssetId: string | null = null;
  let previewTrack: PlayingTrack | null = null;
  const soundboardTracks = new Map<string, PlayingTrack>();

  const broadcastState = () => {
    channel.postMessage({
      type: "state",
      hostId,
      preview: previewAssetId,
      soundboard: [...soundboardTracks.entries()].map(([assetId, t]) => ({ assetId, volume: t.gain.gain.value })),
    } satisfies AudioBridgeMessage);
  };

  const stopNode = (track: PlayingTrack | null) => {
    if (!track) return;
    track.source.onended = null; // this is an intentional stop, not the track finishing on its own
    try {
      track.source.stop();
    } catch {
      /* already stopped/finished - nothing to do */
    }
  };

  const stopPreview = () => {
    stopNode(previewTrack);
    previewTrack = null;
    previewAssetId = null;
  };

  const stopSoundboardTrack = (assetId: string) => {
    const track = soundboardTracks.get(assetId);
    if (!track) return;
    stopNode(track);
    soundboardTracks.delete(assetId);
  };

  const startTrack = async (url: string, volume: number, loop: boolean): Promise<PlayingTrack> => {
    // No-op once actually running (the common case) - only matters the very
    // first time, in case this context started "suspended" per the browser's
    // autoplay policy.
    await audioContext.resume();
    const buffer = await loadBuffer(url);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = loop; // a looping source never fires "ended" on its own - only an explicit stop() does, which is exactly what a soundboard ambience track wants
    const gain = audioContext.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(audioContext.destination);
    source.start();
    return { source, gain };
  };

  channel.onmessage = (event: MessageEvent<AudioBridgeMessage>) => {
    const msg = event.data;
    if (msg.type === "play" && msg.group === "preview") {
      stopPreview();
      const assetId = msg.assetId;
      previewAssetId = assetId;
      startTrack(msg.url, 1, false)
        .then((track) => {
          if (previewAssetId !== assetId) {
            // Superseded by a newer preview while this one was still loading.
            stopNode(track);
            return;
          }
          previewTrack = track;
          track.source.onended = () => {
            if (previewAssetId === assetId) stopPreview();
            broadcastState();
          };
          broadcastState();
        })
        .catch((err) => {
          console.error(`Moulinette | Audio host ${hostId}: preview play() failed for ${assetId}`, err);
          if (previewAssetId === assetId) stopPreview();
          broadcastState();
        });
      broadcastState();
    } else if (msg.type === "stop" && msg.group === "preview") {
      if (previewAssetId === msg.assetId) stopPreview();
      broadcastState();
    } else if (msg.type === "play" && msg.group === "soundboard") {
      stopSoundboardTrack(msg.assetId); // clean restart if it was already playing
      const assetId = msg.assetId;
      startTrack(msg.url, msg.volume ?? 1, msg.loop ?? false)
        .then((track) => {
          soundboardTracks.set(assetId, track);
          track.source.onended = () => {
            soundboardTracks.delete(assetId);
            broadcastState();
          };
          console.log(`Moulinette | Audio host ${hostId}: playing ${assetId}`);
          broadcastState();
        })
        .catch((err) => {
          console.error(`Moulinette | Audio host ${hostId}: play() failed for ${assetId}`, err);
          broadcastState();
        });
    } else if (msg.type === "stop" && msg.group === "soundboard") {
      stopSoundboardTrack(msg.assetId);
      broadcastState();
    } else if (msg.type === "set-volume") {
      const track = soundboardTracks.get(msg.assetId);
      if (track) track.gain.gain.value = msg.volume;
      broadcastState();
    } else if (msg.type === "get-state") {
      broadcastState();
    }
  };
}

// Doesn't need OBR to be ready - the BroadcastChannel and Web Audio API work
// independently of the SDK, and starting this as early as possible means a
// "play" message sent right after the popover first opens has somewhere to
// land instead of racing OBR.onReady.
initAudioHost();

/**
 * Owlbear Rodeo's toolbar action can only open a fixed-size popover (see
 * public/manifest.json), and the browser UI needs much more room than that
 * (filters sidebar + a grid of results). So the popover behind the action icon is
 * this near-invisible page: its only job is to immediately open the real UI as a
 * modal, then close itself.
 *
 * Owlbear keeps this popover's iframe alive across opens rather than reloading it
 * fresh on every click (found by trial and error: opening the modal directly in
 * `OBR.onReady` fired once, whenever the room first loaded the iframe, and never
 * again on later clicks). `onOpenChange` fires every time the popover is actually
 * shown, so the modal reliably (re)opens on every click instead. initAudioHost()
 * above relies on this same persistence for sound playback to survive the modal
 * being closed.
 */
OBR.onReady(() => {
  OBR.action.onOpenChange((isOpen) => {
    if (!isOpen) return;
    OBR.modal.open({
      id: MODAL_ID,
      // A relative "index.html" is NOT resolved against this page's own location
      // by Owlbear - found by trial and error, it gets concatenated onto the bare
      // origin instead (breaking under any subpath deployment, GitHub Pages
      // project sites included: "https://user.github.ioindex.html"). Resolving it
      // ourselves with the standard URL constructor sidesteps that entirely, and
      // still works unchanged in dev/tunnel testing since it's relative to
      // wherever this page itself was actually loaded from.
      url: new URL("index.html", document.baseURI).href,
      width: MODAL_WIDTH,
      height: MODAL_HEIGHT,
    });
    OBR.action.close();
  });
});
