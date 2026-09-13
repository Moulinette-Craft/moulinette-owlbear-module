import OBR from "@owlbear-rodeo/sdk";
import { MODAL_ID } from "./constants";

/**
 * Owlbear Rodeo's toolbar action can only open a fixed-size popover (see
 * public/manifest.json), and the browser UI needs the whole screen to be usable
 * (filters sidebar + a grid of results). So the popover behind the action icon is
 * this near-invisible page: its only job is to immediately open the real UI as a
 * fullscreen modal, then close itself.
 */
OBR.onReady(() => {
  OBR.modal.open({
    id: MODAL_ID,
    // A relative "index.html" is NOT resolved against this page's own location by
    // Owlbear - found by trial and error, it gets concatenated onto the bare
    // origin instead (breaking under any subpath deployment, GitHub Pages project
    // sites included: "https://user.github.ioindex.html"). Resolving it ourselves
    // with the standard URL constructor sidesteps that entirely, and still works
    // unchanged in dev/tunnel testing since it's relative to wherever this page
    // itself was actually loaded from.
    url: new URL("index.html", document.baseURI).href,
    fullScreen: true,
  });
  OBR.action.close();
});
