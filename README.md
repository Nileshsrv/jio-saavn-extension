# Saavn Modern & Lyrics Sidekick

A sleek, modern interface overhaul for JioSaavn modeled after Spotify and Apple Music, featuring time-synced lyrics, cover-art ambiance, and a pop-out mini player.

- **Spotify + Apple Music UI overhaul**: Replaces cluttered banners, ads, and legacy styling with a frosted glassmorphic top bar, pill search bar, dark-surface sidebar, responsive card grids, smooth hover elevations, and a docked glass player bar.
- **Cover-art ambiance**: Extracts dominant colors from the playing track's artwork to softly tint the upper viewport and lyrics panel.
- **Synced lyrics sidekick**: Time-synced lyrics directly beside JioSaavn with album art in the header, smooth active-line focus, and click-to-seek.
- **Quick controls popup**: Click the extension icon to toggle the Modern UI Overhaul, Cover-Art Ambiance, or Ad/Clutter Hiding live without reloading.
- **Pop-out mini player**: Always-on-top Picture-in-Picture window with full playback controls and lyrics sync.

## Install (Chrome, Edge, Brave)
1. Unzip the downloaded archive.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder (or click reload if updating).
4. Open `https://www.jiosaavn.com` and refresh the tab, then play a song.

## Using it
- **Toggle lyrics**: Press `L` anywhere on JioSaavn, click the lyrics icon in the bottom player dock, or click the frosted tab on the right edge.
- **Resize the side panel**: Drag its left edge (double-click to reset, or use Left/Right arrow keys when focused).
- **Adjust timing**: Use the `−` / `+` buttons in the lyrics header to shift timing by 0.5s.
- **Mini player**: Click the pop-out icon in the panel header for an always-on-top window (Chrome/Edge 116+; older browsers open a pop-up). Press `Space` to play/pause.

## Files
- `manifest.json` — Extension config (Manifest V3)
- `theme.css` — Spotify & Apple Music web player overhaul styles
- `panel.css` — Synced lyrics side panel & frosted tab styles
- `content.js` — Track detection, UI controls, lyrics sync, and live preference sync
- `popup.html`, `popup.css`, `popup.js` — Extension toolbar popup for live toggles
- `mini.js` — Pop-out Picture-in-Picture mini player
- `ui.js` — Shared DOM & SVG icon helpers
- `background.js` — LRCLIB lyrics lookup & cover-art palette extraction
- `bridge.js` — Page-world Media Session bridge
- `lib.js` — LRC parser, title normalization, and color palette math
