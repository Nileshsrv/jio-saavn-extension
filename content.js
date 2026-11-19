(() => {
  "use strict";
  if (window.__saavnLyricsLoaded) return;
  window.__saavnLyricsLoaded = true;

  const { parseLRC, findLineIndex } = globalThis.SaavnLyricsLib;
  const { h, icon, createLyricsView } = globalThis.SaavnLyricsUI;
  const H = (tag, attrs, ...kids) => h(document, tag, attrs, ...kids);

  const CONFIG = {
    // Optional fallbacks, as CSS selectors, if the site stops publishing Media Session data
    // or the mini player can't find the site's next/previous buttons on its own.
    selectors: { title: null, artist: null, next: null, prev: null },
    defaultWidth: 380,
    minWidth: 280,
    maxWidth: 720,
    pollMs: 250,
    fetchDelayMs: 700, // let the <audio> element load the new track so its duration is correct
  };

  const OPEN_KEY = "saavn-lyrics-open";
  const WIDTH_KEY = "saavn-lyrics-width";
  const PREF_DEFAULTS = { themeEnabled: true, ambianceEnabled: true, cleanEnabled: true };

  const state = {
    key: "\u0000init", track: null, theme: null,
    lines: [], plain: null, status: "", active: -1,
    offset: 0, reqId: 0, open: true, width: CONFIG.defaultWidth,
  };
  const el = {};
  let view, mini;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- adaptive dark-surface & ink normalizer ----------
  function parseRgb(str) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/i.exec(str || "");
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
  }
  const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

  let normTimer = null;
  function clearNormalized() {
    for (const n of document.querySelectorAll("[data-jsl-surface]")) n.removeAttribute("data-jsl-surface");
    for (const n of document.querySelectorAll("[data-jsl-ink]")) n.removeAttribute("data-jsl-ink");
  }

  function normalizeThemeSurfaces() {
    if (!document.documentElement.classList.contains("jsl-theme-on") || !document.body) return;
    const isOwn = (n) => n.closest && (n.closest("#jsl-panel") || n.closest("#jsl-tab"));
    const isIntentionalLightBtn = (n) =>
      n.closest && n.closest(".c-btn--primary, .c-player__btn--shift, .c-player__btn-play, .c-player__btn-pause");

    for (const node of document.body.querySelectorAll('div, aside, section, nav, ul, ol, li, article, header, footer, form, dialog, [role="dialog"], [role="menu"], [role="listbox"]')) {
      if (isOwn(node) || node.tagName === "BUTTON" || node.getAttribute("role") === "button") continue;
      if (node.hasAttribute("data-jsl-surface")) continue;
      const cs = getComputedStyle(node);
      const bg = parseRgb(cs.backgroundColor);
      if (bg && bg.a > 0.45 && lum(bg) > 0.55) {
        const r = node.getBoundingClientRect();
        if (r.width >= 48 && r.height >= 36) node.setAttribute("data-jsl-surface", "light");
      }
    }

    for (const node of document.body.querySelectorAll(".c-logo svg path, .c-logo svg text")) {
      if (node.hasAttribute("data-jsl-ink")) continue;
      const fl = parseRgb(getComputedStyle(node).fill);
      if (fl && fl.a > 0.4 && lum(fl) < 0.38 && Math.max(fl.r, fl.g, fl.b) - Math.min(fl.r, fl.g, fl.b) < 40) {
        node.setAttribute("data-jsl-ink", "dark");
      }
    }

    for (const node of document.body.querySelectorAll("p, span, a, h1, h2, h3, h4, li, label, svg")) {
      if (isOwn(node) || isIntentionalLightBtn(node)) continue;
      if (node.hasAttribute("data-jsl-ink")) continue;
      const cs = getComputedStyle(node);
      const fg = parseRgb(cs.color);
      if (fg && fg.a > 0.4 && lum(fg) < 0.35) {
        node.setAttribute("data-jsl-ink", "dark");
      }
    }
  }

  function scheduleNormalize() {
    if (normTimer) return;
    normTimer = setTimeout(() => {
      normTimer = null;
      normalizeThemeSurfaces();
    }, 160);
  }

  function startNormalizer() {
    if (!document.body) return;
    scheduleNormalize();
    const obs = new MutationObserver(() => {
      if (document.documentElement.classList.contains("jsl-theme-on")) scheduleNormalize();
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "aria-hidden"] });
  }

  // ---------- UI overhaul preferences ----------
  function applyPrefs(prefs) {
    const root = document.documentElement.classList;
    const themeOn = prefs.themeEnabled !== false;
    root.toggle("jsl-theme-on", themeOn);
    root.toggle("jsl-ambiance-on", prefs.ambianceEnabled !== false);
    root.toggle("jsl-clean-on", prefs.cleanEnabled !== false);
    if (themeOn) scheduleNormalize(); else clearNormalized();
  }

  function initPrefs() {
    applyPrefs(PREF_DEFAULTS);
    try {
      chrome.storage.local.get(PREF_DEFAULTS, (res) => {
        if (!chrome.runtime.lastError && res) applyPrefs(res);
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        const hasPref = Object.keys(PREF_DEFAULTS).some((k) => !!changes[k]);
        if (hasPref) {
          chrome.storage.local.get(PREF_DEFAULTS, (res) => {
            if (!chrome.runtime.lastError && res) applyPrefs(res);
          });
        }
      });
    } catch (_) {}
  }

  // ---------- reading the player ----------
  function pickArtwork(list) {
    if (!list || !list.length) return null;
    const sized = [...list].map((a) => {
      const m = /(\d+)x(\d+)/.exec(a.sizes || "");
      return { src: a.src, px: m ? Number(m[1]) : 0 };
    });
    const pick = sized.filter((a) => a.px >= 100).sort((x, y) => x.px - y.px)[0] || sized.sort((x, y) => y.px - x.px)[0];
    try { return new URL(pick.src, location.href).href; } catch (_) { return null; }
  }

  function readTrack() {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (md && md.title) return { title: md.title, artist: md.artist || "", album: md.album || "", art: pickArtwork(md.artwork) };

    const { title, artist } = CONFIG.selectors;
    const t = title && document.querySelector(title);
    if (t && t.textContent.trim()) {
      const a = artist && document.querySelector(artist);
      return { title: t.textContent.trim(), artist: a ? a.textContent.trim() : "", album: "", art: null };
    }
    return null;
  }

  function findAudio() {
    const media = [...document.querySelectorAll("audio, video")];
    return media.find((m) => !m.paused && m.currentTime > 0) || media.find((m) => m.duration > 0) || media[0] || null;
  }

  // ---------- controlling the player ----------
  // bridge.js (page world) captured the site's Media Session handlers; calling those is the same
  // as pressing a media key, so the site's own UI stays in sync.
  const bridge = {
    actions: new Set(),
    has(a) { return this.actions.has(a); },
    call(action, extra) {
      window.dispatchEvent(new CustomEvent("jsl:action", { detail: JSON.stringify({ action, ...extra }) }));
    },
  };
  window.addEventListener("jsl:actions", (e) => {
    try { bridge.actions = new Set(JSON.parse(e.detail)); } catch (_) {}
  });
  window.dispatchEvent(new CustomEvent("jsl:ping"));

  function fixedAt(x, y) {
    let node = document.elementFromPoint(x, y);
    while (node && node !== document.documentElement) {
      const pos = getComputedStyle(node).position;
      if (pos === "fixed" || pos === "sticky") return node;
      node = node.parentElement;
    }
    return null;
  }
  const centreX = () => Math.max(0, Math.floor((innerWidth - (state.open ? state.width : 0)) / 2));

  // Fallback when the site has no Media Session handler for next/previous: find its button.
  const BTN_RE = {
    next: /(^|[^a-z])(next|skip-?forward)([^a-z]|$)/i,
    prev: /(^|[^a-z])(prev|previous|skip-?back)([^a-z]|$)/i,
  };
  function describe(node, deep) {
    const parts = [node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("data-testid"), node.id,
      typeof node.className === "string" ? node.className : node.getAttribute("class")];
    if (deep) {
      let n = 0;
      for (const c of node.querySelectorAll("[class], use")) {
        if (n++ >= 6) break;
        parts.push(c.getAttribute("class"), c.getAttribute("href"), c.getAttribute("xlink:href"));
      }
    }
    return parts.filter(Boolean).join(" ");
  }
  function clickSiteButton(kind) {
    const custom = CONFIG.selectors[kind];
    const picked = custom && document.querySelector(custom);
    if (picked) { picked.click(); return true; }

    const bar = fixedAt(centreX(), innerHeight - 4) || document;
    const re = BTN_RE[kind];
    const inPanel = (n) => n.closest && n.closest("#jsl-panel");
    for (const n of bar.querySelectorAll('button, [role="button"], a')) {
      if (!inPanel(n) && re.test(describe(n, true))) { n.click(); return true; }
    }
    for (const n of bar.querySelectorAll("i, span, svg, div")) {
      if (!inPanel(n) && re.test(describe(n, false))) { (n.closest('button, [role="button"], a') || n).click(); return true; }
    }
    console.debug(`[Saavn Lyrics] couldn't find the site's "${kind}" button. Set CONFIG.selectors.${kind} in content.js.`);
    return false;
  }

  const controls = {
    toggle() {
      const a = findAudio();
      if (!a) return;
      const action = a.paused ? "play" : "pause";
      if (bridge.has(action)) bridge.call(action);
      else Promise.resolve(a.paused ? a.play() : a.pause()).catch(() => {});
    },
    next() { if (bridge.has("nexttrack")) bridge.call("nexttrack"); else clickSiteButton("next"); },
    prev() { if (bridge.has("previoustrack")) bridge.call("previoustrack"); else clickSiteButton("prev"); },
    seek(t) {
      const a = findAudio();
      if (a && isFinite(t)) a.currentTime = Math.max(0, t);
    },
    seekToLine(t) { controls.seek(t + state.offset); },
    setVolume(v) {
      const a = findAudio();
      if (!a) return;
      a.muted = v <= 0;
      a.volume = clamp(v, 0, 1);
    },
    toggleMute() {
      const a = findAudio();
      if (a) a.muted = !a.muted;
    },
  };

  // ---------- side panel ----------
  function build() {
    view = createLyricsView(document, { onSeek: (t) => controls.seekToLine(t) });
    mini = globalThis.SaavnMini.create({ controls, snapshot, onClosed: syncPopState });

    const iconBtn = (child, title, onClick) => {
      const b = H("button", { type: "button", class: "jsl-btn", title, "aria-label": title }, child);
      b.addEventListener("click", onClick);
      return b;
    };

    el.art = H("img", { class: "jsl-art", alt: "", hidden: "" });
    el.art.addEventListener("error", () => { el.art.hidden = true; });
    el.title = H("p", { class: "jsl-title" });
    el.artist = H("p", { class: "jsl-artist" });
    el.offset = H("span", { class: "jsl-offset", title: "Timing adjustment" }, "0.0s");
    el.pop = iconBtn(icon(document, "popout", 16), "Pop out mini player", togglePopout);
    el.pop.setAttribute("aria-pressed", "false");
    el.toast = H("div", { class: "jsl-toast", role: "status" });
    el.toast.hidden = true;
    el.grip = H("div", {
      class: "jsl-resizer", role: "separator", tabindex: "0", "aria-orientation": "vertical",
      "aria-label": "Resize lyrics panel", title: "Drag to resize \u00b7 double-click to reset",
    });

    el.panel = H(
      "aside", { id: "jsl-panel", "aria-label": "Lyrics" },
      el.grip,
      H("header", { class: "jsl-head" },
        H("div", { class: "jsl-head-left" },
          el.art,
          H("div", { class: "jsl-meta" }, el.title, el.artist)),
        H("div", { class: "jsl-tools" },
          iconBtn("\u2212", "Show lyrics earlier", () => nudge(-0.5)),
          el.offset,
          iconBtn("+", "Show lyrics later", () => nudge(0.5)),
          el.pop,
          iconBtn("\u00d7", "Hide lyrics (L)", () => setOpen(false)))),
      view.body,
      el.toast
    );

    el.tab = H(
      "button",
      { id: "jsl-tab", type: "button", title: "Show lyrics (L)", "aria-label": "Show lyrics" },
      icon(document, "lyrics", 14),
      H("span", { class: "jsl-tab-text" }, "Lyrics")
    );
    el.tab.addEventListener("click", () => setOpen(true));

    document.documentElement.append(el.panel, el.tab);
    setWidth(Number(store.get(WIDTH_KEY)) || CONFIG.defaultWidth, false);
    setupResizer();
    ensurePlayerBarLyricsButton();
  }

  let playerLyricsBtn = null;
  function ensurePlayerBarLyricsButton() {
    if (playerLyricsBtn && playerLyricsBtn.isConnected) return;
    const actions = document.querySelector(".c-player__actions") || document.querySelector(".c-player__controls");
    if (!actions) return;

    playerLyricsBtn = H(
      "button",
      {
        type: "button",
        class: "jsl-player-lyrics-btn" + (state.open ? " is-active" : ""),
        title: state.open ? "Hide lyrics (L)" : "Show lyrics (L)",
        "aria-label": "Lyrics",
        "aria-pressed": state.open ? "true" : "false"
      },
      icon(document, "lyrics", 18)
    );
    playerLyricsBtn.addEventListener("click", () => setOpen(!state.open));
    actions.append(playerLyricsBtn);
  }

  function setWidth(w, persist) {
    const max = Math.max(CONFIG.minWidth, Math.min(CONFIG.maxWidth, Math.round(innerWidth * 0.6)));
    state.width = clamp(Math.round(w), CONFIG.minWidth, max);
    document.documentElement.style.setProperty("--jsl-w", state.width + "px");
    el.grip.setAttribute("aria-valuemin", String(CONFIG.minWidth));
    el.grip.setAttribute("aria-valuemax", String(max));
    el.grip.setAttribute("aria-valuenow", String(state.width));
    if (persist) store.set(WIDTH_KEY, String(state.width));
  }

  function setupResizer() {
    const root = document.documentElement;
    let dragging = false;
    const end = () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("jsl-resizing");
      store.set(WIDTH_KEY, String(state.width));
      layout();
    };
    el.grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      root.classList.add("jsl-resizing");
      try { el.grip.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    el.grip.addEventListener("pointermove", (e) => { if (dragging) setWidth(innerWidth - e.clientX, false); });
    el.grip.addEventListener("pointerup", end);
    el.grip.addEventListener("pointercancel", end);
    el.grip.addEventListener("dblclick", () => setWidth(CONFIG.defaultWidth, true));
    el.grip.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 60 : 20;
      if (e.key === "ArrowLeft") setWidth(state.width + step, true);
      else if (e.key === "ArrowRight") setWidth(state.width - step, true);
      else if (e.key === "Home") setWidth(CONFIG.minWidth, true);
      else if (e.key === "End") setWidth(CONFIG.maxWidth, true);
      else return;
      e.preventDefault();
    });
  }

  function setOpen(open) {
    state.open = open;
    document.documentElement.classList.toggle("jsl-open", open);
    store.set(OPEN_KEY, open ? "1" : "0");
    if (playerLyricsBtn) {
      playerLyricsBtn.classList.toggle("is-active", open);
      playerLyricsBtn.setAttribute("aria-pressed", open ? "true" : "false");
      playerLyricsBtn.setAttribute("title", open ? "Hide lyrics (L)" : "Show lyrics (L)");
    }
    if (open) { layout(); view.reveal(); }
  }

  // Keep the panel clear of the site's fixed header and player bar (best effort).
  function insetAt(y, edge) {
    const node = fixedAt(centreX(), y);
    if (!node) return 0;
    const r = node.getBoundingClientRect();
    const v = edge === "top" ? r.bottom : innerHeight - r.top;
    return v > 0 && v <= 200 ? Math.round(v) : 0;
  }
  function layout() {
    const s = document.documentElement.style;
    s.setProperty("--jsl-top", insetAt(4, "top") + "px");
    s.setProperty("--jsl-bottom", insetAt(innerHeight - 4, "bottom") + "px");
  }

  let toastTimer;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4500);
  }

  function nudge(delta) {
    state.offset = Math.round((state.offset + delta) * 10) / 10;
    el.offset.textContent = (state.offset > 0 ? "+" : "") + state.offset.toFixed(1) + "s";
  }

  // ---------- mini player ----------
  function togglePopout() {
    if (mini.isOpen()) { mini.close(); return; }
    // Called synchronously from the click; the browser needs that to allow the window.
    mini.open().then(syncPopState, (err) => {
      console.debug("[Saavn Lyrics] mini player failed:", err);
      toast("Couldn\u2019t open the mini player. Allow pop-ups for this site and try again.");
    });
  }
  function syncPopState() {
    el.pop.setAttribute("aria-pressed", String(mini.isOpen()));
  }
  const snapshot = () => ({
    track: state.track, theme: state.theme,
    lines: state.lines, plain: state.plain, status: state.status, active: state.active,
  });

  // ---------- theme from cover art ----------
  const THEME_VARS = { base: "--jsl-base", glow1: "--jsl-glow1", glow2: "--jsl-glow2", accent: "--jsl-accent" };
  function applyTheme(theme) {
    state.theme = theme || null;
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(THEME_VARS)) {
      if (theme && theme[k]) root.setProperty(v, theme[k]); else root.removeProperty(v);
    }
    mini.setTheme(state.theme);
  }
  function requestTheme(track, id) {
    if (!track || !track.art) return applyTheme(null);
    try {
      chrome.runtime.sendMessage({ type: "COVER_THEME", src: track.art }, (res) => {
        if (id !== state.reqId) return;
        if (chrome.runtime.lastError || !res || res.status !== "ok") {
          console.debug("[Saavn Lyrics] cover colours unavailable:", (res && res.message) || chrome.runtime.lastError);
          return applyTheme(null);
        }
        applyTheme(res.theme);
      });
    } catch (_) { /* extension reloaded; the lyrics path already tells the user */ }
  }

  // ---------- lyrics ----------
  // Every change to what the lyrics area shows goes through here, so both windows stay identical.
  function setLyrics({ lines = [], plain = null, status = "" }) {
    state.lines = lines;
    state.plain = plain;
    state.status = status;
    state.active = -1;
    if (plain) view.setPlain(plain); else view.setLines(lines);
    view.setStatus(status);
    mini.setLyrics({ lines, plain, status });
  }

  function onTrackChange(track, key) {
    state.key = key;
    state.reqId += 1;
    state.track = track;
    state.offset = 0;
    el.offset.textContent = "0.0s";
    document.documentElement.classList.toggle("jsl-has-track", !!track);
    mini.setTrack(track);

    if (!track) {
      el.title.textContent = "Lyrics";
      el.artist.textContent = "";
      el.art.hidden = true;
      setLyrics({ status: "Play a song on JioSaavn and its lyrics will show up here." });
      applyTheme(null);
      return;
    }
    el.title.textContent = track.title;
    el.artist.textContent = track.artist;
    if (track.art) {
      if (el.art.getAttribute("src") !== track.art) el.art.src = track.art;
      el.art.hidden = false;
    } else {
      el.art.hidden = true;
    }

    setLyrics({ status: "Finding lyrics\u2026" });
    requestTheme(track, state.reqId);
    console.debug("[Saavn Lyrics] now playing:", track.title, "\u2013", track.artist);

    const id = state.reqId;
    setTimeout(() => {
      if (id !== state.reqId) return;
      const audio = findAudio();
      const duration = audio && isFinite(audio.duration) ? audio.duration : 0;
      try {
        chrome.runtime.sendMessage({ type: "FETCH_LYRICS", track: { ...track, duration } }, (res) => {
          if (id !== state.reqId) return;
          if (chrome.runtime.lastError || !res) return setLyrics({ status: "Couldn\u2019t reach the lyrics service. Reload the page and try again." });
          applyResult(res);
        });
      } catch (_) {
        setLyrics({ status: "The extension was updated. Reload this page to keep using lyrics." });
      }
    }, CONFIG.fetchDelayMs);
  }

  function applyResult(res) {
    if (res.status === "error") return setLyrics({ status: "Couldn\u2019t load lyrics right now. Check your connection and try the next song." });
    if (res.instrumental) return setLyrics({ status: "Instrumental \u2014 no lyrics for this one." });

    const synced = res.synced ? parseLRC(res.synced) : [];
    if (synced.length) setLyrics({ lines: synced });
    else if (res.plain) setLyrics({ plain: res.plain, status: "These lyrics aren\u2019t timed, so they won\u2019t follow the song." });
    else setLyrics({ status: "No lyrics found for this song yet. Regional songs are less covered in the community lyrics catalog." });
  }

  // ---------- sync loop ----------
  function syncActive(audio) {
    if (!state.lines.length || !audio) return;
    const idx = findLineIndex(state.lines, audio.currentTime - state.offset);
    if (idx === state.active) return;
    state.active = idx;
    view.setActive(idx);
    mini.setActive(idx);
  }

  function tick() {
    ensurePlayerBarLyricsButton();

    const track = readTrack();
    const key = track ? `${track.title}|${track.artist}` : "";
    if (key !== state.key) onTrackChange(track, key);

    const audio = findAudio();
    syncActive(audio);
    if (mini.isOpen()) {
      mini.tick({
        playing: !!audio && !audio.paused,
        time: audio ? audio.currentTime : 0,
        duration: audio && isFinite(audio.duration) ? audio.duration : 0,
        volume: audio ? audio.volume : 1,
        muted: audio ? audio.muted : false,
      });
    } else if (el.pop.getAttribute("aria-pressed") === "true") {
      syncPopState(); // window was closed from its own title bar
    }
  }

  // ---------- shortcuts & popup messages ----------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      setOpen(!state.open);
    }
  });

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return false;
      if (msg.type === "GET_STATE") {
        sendResponse({ open: state.open, track: state.track });
        return true;
      }
      if (msg.type === "TOGGLE_LYRICS") {
        setOpen(!state.open);
        sendResponse({ open: state.open });
        return true;
      }
      return false;
    });
  } catch (_) {}

  // ---------- boot ----------
  initPrefs();
  build();
  startNormalizer();
  setOpen(store.get(OPEN_KEY) !== "0");
  tick(); // first render; state.key starts as a sentinel so this always runs
  setInterval(tick, CONFIG.pollMs);
  setInterval(() => state.open && layout(), 4000);
  addEventListener("resize", () => { setWidth(state.width, false); if (state.open) layout(); });
})();
