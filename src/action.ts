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

/**
 * Owns the actual <audio> element for sound-effect previews (see
 * src/audioBridge.ts for why it lives here rather than in the browser modal)
 * - relays play/stop commands from whichever modal instance is currently
 * open, if any, and reports state changes back so a (re)opened modal can
 * show the right play/pause icon for whatever's already playing.
 */
function initAudioHost(): void {
  const audio = document.getElementById("mou-audio") as HTMLAudioElement;
  const channel = openAudioChannel();
  let currentAssetId: string | null = null;

  const broadcastState = () => {
    channel.postMessage({ type: "state", assetId: currentAssetId } satisfies AudioBridgeMessage);
  };

  channel.onmessage = (event: MessageEvent<AudioBridgeMessage>) => {
    const msg = event.data;
    if (msg.type === "play") {
      currentAssetId = msg.assetId;
      audio.src = msg.url;
      audio
        .play()
        .catch(() => {
          currentAssetId = null;
        })
        .finally(broadcastState);
    } else if (msg.type === "stop") {
      audio.pause();
      currentAssetId = null;
      broadcastState();
    } else if (msg.type === "get-state") {
      broadcastState();
    }
  };

  audio.addEventListener("ended", () => {
    currentAssetId = null;
    broadcastState();
  });
}

// Doesn't need OBR to be ready - the BroadcastChannel and <audio> element
// work independently of the SDK, and starting this as early as possible means
// a "play" message sent right after the popover first opens has somewhere to
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
