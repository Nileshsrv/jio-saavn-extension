// Pure helpers shared by the content script and the background worker.
// No DOM or extension APIs in here, so it can be unit-tested in Node.
(function (root) {
  "use strict";

  function decodeEntities(s) {
    return (s || "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  // Lowercase, strip Latin diacritics, drop punctuation. \p{M} keeps Indic vowel signs intact.
  function norm(s) {
    return decodeEntities(s)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 'Kuthu Fire (From "Vaarisu")' -> 'Kuthu Fire'
  function cleanTitle(title) {
    return decodeEntities(title)
      .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, (m) =>
        /\b(from|feat|ft|with|remix|lofi|lo-fi|version|reprise|unplugged|acoustic|original|motion picture|soundtrack|ost|theme)\b/i.test(m) ? "" : m
      )
      .replace(/\s+-\s+(from|feat|ft)\b.*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function splitArtists(artist) {
    return decodeEntities(artist)
      .split(/\s*(?:,|;|&|\band\b|\bfeat\.?|\bft\.?|\bx\b)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // "[01:23.45] some words" -> [{ time: 83.45, text: "some words" }]
  function parseLRC(text) {
    const stamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const out = [];
    for (const raw of (text || "").split(/\r?\n/)) {
      const stamps = [...raw.matchAll(stamp)];
      if (!stamps.length) continue;
      const words = raw.replace(stamp, "").trim();
      for (const m of stamps) {
        const frac = m[3] ? Number("0." + m[3]) : 0;
        out.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text: words });
      }
    }
    return out.sort((a, b) => a.time - b.time);
  }

  // Index of the last line whose time <= t, or -1 if playback hasn't reached line 0.
  function findLineIndex(lines, t) {
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  }

  // Choose the LRCLIB result that most likely matches the playing track.
  // Rejects results that match neither the artist nor the duration, so we never show the wrong song's lyrics.
  function pickBest(results, q) {
    const wantTitle = norm(cleanTitle(q.title));
    const wantArtists = splitArtists(q.artist).map(norm).filter(Boolean);
    let best = null, bestScore = -Infinity;

    for (const r of results || []) {
      if (!r || (!r.syncedLyrics && !r.plainLyrics && !r.instrumental)) continue;
      const rt = norm(r.trackName || r.name);
      const ra = norm(r.artistName);
      if (!rt || !wantTitle) continue;
      if (!(rt === wantTitle || rt.includes(wantTitle) || wantTitle.includes(rt))) continue;

      const artistOk = ra && wantArtists.some((a) => ra.includes(a) || a.includes(ra));
      const diff = q.duration > 0 && r.duration > 0 ? Math.abs(q.duration - r.duration) : null;
      if (!artistOk && !(diff !== null && diff <= 4)) continue;

      const score =
        (r.syncedLyrics ? 4 : 0) +
        (artistOk ? 3 : 0) +
        (rt === wantTitle ? 2 : 0) -
        (diff === null ? 0 : Math.min(diff, 30) / 5);
      if (score > bestScore) { best = r; bestScore = score; }
    }
    return best;
  }


  // ---------- cover colour helpers ----------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s, l };
  }

  // RGBA pixel data (e.g. a 48x48 downscale of the cover) -> [primary, secondary|null] as {r,g,b}.
  // Colourful, mid-lightness pixels win, so a white sleeve with one red logo still gives red.
  function pickPalette(data) {
    const BINS = 12;
    const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let tr = 0, tg = 0, tb = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      tr += r; tg += g; tb += b; n++;
      const { h, s, l } = rgbToHsl(r, g, b);
      if (l < 0.08 || l > 0.95) continue;
      const w = s * (1 - Math.abs(2 * l - 1));
      const bin = bins[Math.floor(h / (360 / BINS)) % BINS];
      bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
    }
    if (!n) return [{ r: 40, g: 60, b: 60 }, null];

    let top = 0;
    bins.forEach((b, i) => { if (b.w > bins[top].w) top = i; });
    if (bins[top].w < n * 0.02) {
      // Practically greyscale cover: stay neutral instead of inventing a hue.
      const avg = { r: tr / n, g: tg / n, b: tb / n };
      return [avg, null];
    }
    const toRgb = (b) => ({ r: b.r / b.w, g: b.g / b.w, b: b.b / b.w });

    let second = -1;
    bins.forEach((b, i) => {
      const dist = Math.min((i - top + BINS) % BINS, (top - i + BINS) % BINS);
      if (dist >= 2 && b.w >= bins[top].w * 0.2 && (second < 0 || b.w > bins[second].w)) second = i;
    });
    return [toRgb(bins[top]), second >= 0 ? toRgb(bins[second]) : null];
  }

  // Two cover colours -> the CSS colours the panel uses. Lightness is fixed per role so text stays readable.
  function buildTheme(c1, c2) {
    const a = rgbToHsl(c1.r, c1.g, c1.b);
    const b = c2 ? rgbToHsl(c2.r, c2.g, c2.b) : { h: (a.h + 30) % 360, s: a.s };
    const sat = (s, f, lo, hi) => (s < 0.12 ? s : clamp(s * f, lo, hi));
    const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
    return {
      base: hsl(a.h, clamp(a.s * 0.6, 0, 0.5), 0.12),
      glow1: hsl(a.h, sat(a.s, 1.15, 0.4, 0.85), 0.4),
      glow2: hsl(b.h, sat(b.s, 1.1, 0.35, 0.8), 0.34),
      accent: hsl(a.h, sat(a.s, 1.2, 0.5, 0.9), 0.68),
    };
  }

  const api = { rgbToHsl, pickPalette, buildTheme, norm, cleanTitle, splitArtists, parseLRC, findLineIndex, pickBest };
  root.SaavnLyricsLib = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
