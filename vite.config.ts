import { defineConfig } from "vite";
import { resolve } from "node:path";

// Three entry points are built:
//  - index.html     : the full browser UI, opened as a fullscreen OBR.modal
//  - action.html    : the tiny page behind the toolbar action icon. Owlbear Rodeo
//    extensions can only declare a fixed-size popover as their action, so this
//    page's only job is to immediately open the fullscreen modal and close
//    the popover behind it (see src/action.ts).
//  - soundboard.html: the SoundPads & SoundBoards panel, opened as its own
//    OBR.popover (not nested inside index.html's modal) so it can stay
//    docked to the screen edge and open at the same time as - instead of on
//    top of - the rest of Owlbear's own UI (see src/soundboardMain.ts).
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        action: resolve(__dirname, "action.html"),
        soundboard: resolve(__dirname, "soundboard.html"),
      },
    },
  },
  server: {
    // Owlbear Rodeo loads the extension over HTTPS from another origin, so the
    // dev server must accept cross-origin requests while testing locally
    // (e.g. via a tunnel such as ngrok/localtunnel pointed at this port).
    cors: true,
    // Vite rejects requests whose Host header it doesn't recognize (e.g. a
    // tunnel's own subdomain), so each tunnel hostname used for local testing
    // needs to be listed here explicitly.
    allowedHosts: [],
  },
});
