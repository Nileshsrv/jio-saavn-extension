// Service worker: looks up lyrics on LRCLIB (free, no API key) and caches results.
importScripts("lib.js");
const { cleanTitle, splitArtists, pickBest, norm, pickPalette, buildTheme } = self.SaavnLyricsLib;

const API = "https://lrclib.net/api/search";
const MISS_TTL_MS = 6 * 60 * 60 * 1000; // retry songs with no lyrics after 6 hours

async function search(params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${API}?${new URLSearchParams(params)}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`LRCLIB responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(track) {
  const title = cleanTitle(track.title);
  const artist = splitArtists(track.artist)[0] || "";

  // Most specific query first, then progressively looser ones.
  const attempts = [
    artist ? { track_name: title, artist_name: artist } : null,
    { q: `${title} ${artist}`.trim() },
    { track_name: title },
  ].filter(Boolean);

  for (const params of attempts) {
    const hit = pickBest(await search(params), track);
    if (hit) {
      return {
        status: "ok",
        synced: hit.syncedLyrics || null,
        plain: hit.plainLyrics || null,
        instrumental: !!hit.instrumental,
      };
    }
  }
  return { status: "none" };
}

async function getLyrics(track) {
  const key = `lyr:${norm(cleanTitle(track.title))}|${norm(splitArtists(track.artist)[0] || "")}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && (cached.status === "ok" || Date.now() - cached.ts < MISS_TTL_MS)) return cached;

  const result = await lookup(track);
  await chrome.storage.local.set({ [key]: { ...result, ts: Date.now() } });
  return result;
}

// Cover art -> palette. Done here (not in the page) because the host permission lets us read
// the image pixels without CORS headers, which a page canvas could not.
async function getCoverTheme(src) {
  if (!/^https:\/\//i.test(src || "")) throw new Error("bad artwork url");
  const key = `cov:${src}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return { status: "ok", theme: cached };

  const res = await fetch(src);
  if (!res.ok) throw new Error(`artwork responded ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { resizeWidth: 48, resizeHeight: 48, resizeQuality: "low" });
  const canvas = new OffscreenCanvas(48, 48);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  const [c1, c2] = pickPalette(ctx.getImageData(0, 0, 48, 48).data);
  const theme = buildTheme(c1, c2);
  await chrome.storage.local.set({ [key]: theme });
  return { status: "ok", theme };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  let job;
  if (msg.type === "FETCH_LYRICS") job = getLyrics(msg.track);
  else if (msg.type === "COVER_THEME") job = getCoverTheme(msg.src);
  else return false;
  job.then(sendResponse).catch((err) => sendResponse({ status: "error", message: String(err) }));
  return true; // keep the channel open for the async reply
});
