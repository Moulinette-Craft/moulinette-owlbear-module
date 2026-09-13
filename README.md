# Moulinette Media Search (Owlbear Rodeo extension)

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension that brings the core of the
[FoundryVTT Moulinette module](https://github.com/SvenWerlen/moulinette-foundryvtt-module)
to Owlbear: search, preview and drop maps, images, icons and sound effects onto your
scene, without leaving the game.

#### Features

- Browse, search and drop maps/images from **Moulinette Cloud** - your own content and
  content from creators you support.
- Search and drop icons from **[Game-icons.net](https://game-icons.net)**, recolorable.
- Search and drop icons from the **Font Awesome Free** set.
- Search and preview sound effects from **[BBC Sound Effects](https://sound-effects.bbcrewind.co.uk/)**
  (non-commercial use, see their [licensing](https://sound-effects.bbcrewind.co.uk/licensing)),
  played locally in your own browser.

## Differences from the FoundryVTT module

Owlbear Rodeo is a different kind of platform - extensions are sandboxed web pages
with no server-side file system access and no compendium/document system - so this is
a focused subset rather than a 1:1 port. Compared to the FoundryVTT module:

- **No compendiums, no local asset browsing.** Both rely on FoundryVTT's own server
  and document system, which Owlbear has no equivalent of.
- **Sound effects play locally only**, in the browser of whoever clicks "play" - there
  is no shared soundboard/playlist system in Owlbear to import into, and no attempt is
  made to sync playback across players.
- **Scenes, actors, items, journal entries, macros, roll tables, adventures and PDFs
  are not supported** - Owlbear has no matching document types. Only **maps, images,
  icons and audio** are, since those map directly onto Owlbear's own image items.
- **Single language (English)**, no settings-driven configuration screen - only a
  small "advanced settings" panel (source pixels/cell for maps, icon colors).
- The Moulinette account session is kept in this browser's `localStorage`, never in
  Owlbear room/player metadata (that's broadcast to every other player in the room,
  which would otherwise leak your session token to them).

## Project layout

```
public/manifest.json   Extension manifest (name, icon, toolbar action)
public/data/fa-icons.json  Bundled Font Awesome Free icon list
action.html / src/action.ts   Tiny page behind the toolbar icon; immediately opens
                               the real UI as a fullscreen modal (Owlbear's toolbar
                               action can only open a small fixed-size popover)
index.html / src/main.ts      The actual browser UI, opened as a fullscreen modal
src/types.ts            MediaCollection/MediaAsset abstraction every source plugs into
src/collections/*.ts     One collection per content source (cloud, game-icons,
                         fontawesome, bbc-sounds)
src/clients/*.ts         Thin fetch wrappers around each external API
src/obr/scene.ts         Adds an image to the Owlbear scene via the SDK's item builders
src/ui/browser.ts        The actual UI: filters, search, results grid, actions
src/auth.ts              Patreon/Discord OAuth flow for the Moulinette account
```

## Development

```bash
npm install
npm run dev      # Vite dev server, defaults to http://localhost:5173
```

Owlbear Rodeo loads extensions from a **public HTTPS URL** - it can't load a plain
`localhost` address directly. To test against the dev server, expose it through a
tunnel (e.g. `npx localtunnel --port 5173` or `ngrok http 5173`), then in Owlbear
Rodeo: profile menu → **Add Extension** → paste the tunnel's
`.../manifest.json` URL.

`npm run build` produces a static `dist/` folder (`npm run typecheck` alone just
runs the TypeScript compiler). Deploy `dist/` as-is to any static HTTPS host of your
choice (GitHub Pages, Vercel, Cloudflare Pages, your own moulinette.cloud
infrastructure, ...) and point the extension's manifest URL at
`https://<your-host>/manifest.json`.

Every path the app references (the manifest's `icon`/`action.popover`, the modal URL
in `src/action.ts`, the Font Awesome data file) is **relative**, resolved against
wherever the page/manifest itself was loaded from - so it works both at a domain
root (`https://owlbear.moulinette.cloud/`) and under a subpath
(`https://<user>.github.io/moulinette-owlbear-module/`), with nothing to adjust
either way.

## Hosting on GitHub Pages

`.github/workflows/publish.yml` builds and deploys `dist/` to GitHub Pages
automatically on every push to `main` (or on demand from the Actions tab). One-time
setup, once the repo is pushed to GitHub:

1. Repo **Settings → Pages → Build and deployment → Source**: select **GitHub
   Actions** (not "Deploy from a branch").
2. Push to `main` (or run the workflow manually) - the "Publish to GitHub Pages" run
   prints the resulting URL, normally
   `https://<user-or-org>.github.io/moulinette-owlbear-module/`.
3. Use `<that URL>manifest.json` as the extension's install URL in Owlbear Rodeo.

To serve it from a nicer URL later (e.g. `owlbear.moulinette.cloud`) instead of the
`github.io` subpath, add a **Custom domain** in the same Pages settings screen and
point a DNS `CNAME` record for that subdomain at `<user-or-org>.github.io` - no code
change needed on this end, since every path is already relative.

## License

MIT, same as the FoundryVTT module.
