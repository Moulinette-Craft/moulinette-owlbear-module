import OBR from "@owlbear-rodeo/sdk";
import { MoulinetteBrowser } from "./ui/browser";
import { debugLog } from "./debug";

debugLog("main.ts loaded, document.baseURI =", document.baseURI, "OBR.isAvailable =", OBR.isAvailable);

const app = document.getElementById("app")!;

OBR.onReady(async () => {
  debugLog("OBR.onReady fired, mounting browser");
  const browser = new MoulinetteBrowser(app);
  await browser.mount();
  debugLog("browser.mount() done");
});

// Allow opening this page directly in a normal browser tab (outside of Owlbear
// Rodeo) for quick UI iteration during development - OBR.isReady never resolves
// there since there's no host page to talk to.
if (!OBR.isAvailable) {
  app.innerHTML = `<div style="padding:2rem;font-family:sans-serif">This page only works when embedded inside Owlbear Rodeo.</div>`;
}
