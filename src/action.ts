import OBR from "@owlbear-rodeo/sdk";
import { MODAL_ID } from "./constants";

// A large fixed size rather than fullScreen: true - takes up a good part of the
// screen without covering the whole room. Owlbear's modal has no drag-to-resize
// handles of its own (there's no such option on the SDK's Modal type - width and
// height are the only size controls it exposes), so this is as close to
// "resizable" as the platform allows for a modal.
const MODAL_WIDTH = 1400;
const MODAL_HEIGHT = 900;

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
 * shown, so the modal reliably (re)opens on every click instead.
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
