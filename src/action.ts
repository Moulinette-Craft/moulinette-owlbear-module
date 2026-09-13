import OBR from "@owlbear-rodeo/sdk";
import { MODAL_ID } from "./constants";

/**
 * Owlbear Rodeo's toolbar action can only open a fixed-size popover (see
 * public/manifest.json), and the browser UI needs the whole screen to be usable
 * (filters sidebar + a grid of results). So the popover behind the action icon is
 * this near-invisible page: its only job is to immediately open the real UI as a
 * fullscreen modal, then close itself.
 *
 * Owlbear keeps this popover's iframe alive across opens rather than reloading it
 * fresh on every click (found by trial and error: opening the modal directly in
 * `OBR.onReady` fired once, whenever the room first loaded the iframe, and never
 * again on later clicks). `onOpenChange` fires every time the popover is actually
 * shown, so the modal reliably (re)opens on every click instead.
 */
console.log("[Moulinette] action.ts loaded, document.baseURI =", document.baseURI);

OBR.onReady(() => {
  console.log("[Moulinette] action.ts: OBR.onReady fired, subscribing to onOpenChange");
  OBR.action.onOpenChange((isOpen) => {
    console.log("[Moulinette] action.ts: onOpenChange", isOpen);
    if (!isOpen) return;
    const url = new URL("index.html", document.baseURI).href;
    console.log("[Moulinette] action.ts: opening modal with url", url);
    OBR.modal.open({
      id: MODAL_ID,
      // A relative "index.html" is NOT resolved against this page's own location
      // by Owlbear - found by trial and error, it gets concatenated onto the bare
      // origin instead (breaking under any subpath deployment, GitHub Pages
      // project sites included: "https://user.github.ioindex.html"). Resolving it
      // ourselves with the standard URL constructor sidesteps that entirely, and
      // still works unchanged in dev/tunnel testing since it's relative to
      // wherever this page itself was actually loaded from.
      url,
      fullScreen: true,
    });
    OBR.action.close();
  });
});
