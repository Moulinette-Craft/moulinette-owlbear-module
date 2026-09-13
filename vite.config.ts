import { defineConfig } from "vite";
import { resolve } from "node:path";

// Two entry points are built:
//  - index.html : the full browser UI, opened as a fullscreen OBR.modal
//  - action.html: the tiny page behind the toolbar action icon. Owlbear Rodeo
//    extensions can only declare a fixed-size popover as their action, so this
//    page's only job is to immediately open the fullscreen modal and close
//    the popover behind it (see src/action.ts).
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        action: resolve(__dirname, "action.html"),
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
