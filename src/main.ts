import OBR from "@owlbear-rodeo/sdk";
import { MoulinetteBrowser } from "./ui/browser";

const app = document.getElementById("app")!;

OBR.onReady(async () => {
  const browser = new MoulinetteBrowser(app);
  await browser.mount();
});

// Allow opening this page directly in a normal browser tab (outside of Owlbear
// Rodeo) for quick UI iteration during development - OBR.isReady never resolves
// there since there's no host page to talk to.
if (!OBR.isAvailable) {
  app.innerHTML = `<div style="padding:2rem;font-family:sans-serif">This page only works when embedded inside Owlbear Rodeo.</div>`;
}
