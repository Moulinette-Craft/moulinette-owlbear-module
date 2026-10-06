# Changelog

## 0.5.0

- SoundPads: each sound can now play once, loop, or repeat with a pause between
  plays (every 5 s, 10 s, 15 s, 30 s, 1 min, 2 min, 3 min, 5 min, 15 min or
  30 min). The pause starts when the sound ends and varies randomly by up to
  +25% so it doesn't sound mechanical - e.g. a looping song, a monster roar
  about once a minute and footsteps every few seconds, all at the same time.
  Repeats keep going while the SoundPads panel is closed.
- The loop toggle from 0.4.0 is replaced by this play-mode menu; your previous
  loop choices are kept.

## 0.4.0

- SoundPads: alternate versions of a music (e.g. "ambience only") are now listed
  under the original track, like in the FoundryVTT module. Click a track with
  alternates to show every version. Searching also finds alternates.
- SoundPads: each sound has a loop toggle. The default (looping ambience) is
  kept, your choice is remembered, and it applies right away to a playing track.

## 0.3.0

- New SoundPads & SoundBoards panel for Tabletop Audio and Michael Ghelfi, with
  multiple tracks playable at once and looping ambience.
- Sound effects keep playing after the browser window is closed.
