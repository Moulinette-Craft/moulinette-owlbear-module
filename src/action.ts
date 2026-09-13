import OBR from "@owlbear-rodeo/sdk";
import { EXTENSION_ID } from "./constants";

/**
 * Owlbear Rodeo's toolbar action can only open a fixed-size popover (see
 * public/manifest.json), and the browser UI needs the whole screen to be usable
 * (filters sidebar + a grid of results). So the popover behind the action icon is
 * this near-invisible page: its only job is to immediately open the real UI as a
 * fullscreen modal, then close itself.
 */
OBR.onReady(() => {
  const modalId = `${EXTENSION_ID}/browser`;
  OBR.modal.open({
    id: modalId,
    // Relative, not "/index.html": this page and index.html are always served as
    // siblings from wherever the extension is hosted (including under a GitHub
    // Pages project subpath like "/moulinette-owlbear-module/"), and a
    // root-absolute path would resolve to the wrong place there.
    url: "index.html",
    fullScreen: true,
  });
  OBR.action.close();
});
