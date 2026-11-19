// Mini player in a pop-out window.
// Uses Document Picture-in-Picture (Chrome/Edge 116+): a small always-on-top window that stays
// above other apps and tabs. Falls back to a normal pop-up window where that API doesn't exist.
(function (root) {
  "use strict";
  const { h, icon, createLyricsView } = root.SaavnLyricsUI;

  const MODE_KEY = "saavn-lyrics-mini-mode";
  const MODES = ["off", "line", "full"];
  const SIZES = { off: { w: 380, h: 236 }, line: { w: 380, h: 330 }, full: { w: 380, h: 600 } };
  const THEME_VARS = { base: "--jsl-base", glow1: "--jsl-glow1", glow2: "--jsl-glow2", accent: "--jsl-accent" };

  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  const CSS = `
@property --jsl-base   { syntax: "<color>"; inherits: true; initial-value: #0e1d20; }
@property --jsl-glow1  { syntax: "<color>"; inherits: true; initial-value: #1f7d73; }
@property --jsl-glow2  { syntax: "<color>"; inherits: true; initial-value: #1c5a6e; }
@property --jsl-accent { syntax: "<color>"; inherits: true; initial-value: #2bc5b4; }

:root {
  --dim: rgba(255,255,255,0.68);
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Noto Serif", Georgia, serif;
  --sans: system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif;
  transition: --jsl-base .9s ease, --jsl-glow1 .9s ease, --jsl-glow2 .9s ease, --jsl-accent .9s ease;
}
* { box-sizing: border-box; }
html {
  height: 100%;
  background:
    radial-gradient(130% 60% at 0% 0%, color-mix(in srgb, var(--jsl-glow1) 78%, transparent), transparent 64%),
    radial-gradient(110% 55% at 100% 100%, color-mix(in srgb, var(--jsl-glow2) 72%, transparent), transparent 66%),
    var(--jsl-base);
}
body { margin: 0; height: 100%; overflow: hidden; font-family: var(--sans); color: #fff; }
button { font-family: inherit; }

.jm-root { position: relative; display: flex; flex-direction: column; height: 100%; isolation: isolate; }
.jm-root::before {
  content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: linear-gradient(125deg, rgba(255,255,255,.13) 0%, rgba(255,255,255,.03) 28%, transparent 46%);
}

.jm-top { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
.jm-cover {
  flex: none; width: 52px; height: 52px; border-radius: 10px; object-fit: cover;
  box-shadow: 0 6px 18px -8px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.18);
}
.jm-cover[hidden] { display: none; }
.jm-meta { flex: 1; min-width: 0; }
.jm-title, .jm-artist { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jm-title { font-size: 14px; font-weight: 650; line-height: 1.3; }
.jm-artist { font-size: 12px; line-height: 1.4; color: var(--dim); }

.jm-mode {
  flex: none; display: flex; padding: 2px; border-radius: 10px;
  background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.14);
}
.jm-mode button {
  padding: 5px 9px; font-size: 11px; font-weight: 600; color: var(--dim);
  background: transparent; border: 0; border-radius: 8px; cursor: pointer;
}
.jm-mode button:hover { color: #fff; }
.jm-mode button[aria-pressed="true"] { color: #fff; background: rgba(255,255,255,.20); }

/* Lyrics live in their own box between header and controls: they wrap and get clipped
   inside it, never spilling over the title or the sliders. */
.jm-top, .jm-controls { flex: none; position: relative; z-index: 1; }
.jm-lyrics {
  flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center;
  padding: 0 16px; overflow: hidden; container-type: size;
}
.jm-root[data-mode="off"] .jm-lyrics { display: none; }
.jm-root[data-mode="line"] .jm-full { display: none; }
.jm-root[data-mode="full"] .jm-line-view { display: none; }
.jm-line-view {
  max-height: 100%; min-height: 0; display: flex; flex-direction: column; justify-content: safe center;
  padding: 4px 0; text-align: center; overflow-y: auto; scrollbar-width: none;
}
.jm-line-view::-webkit-scrollbar { display: none; }
.jm-now, .jm-next { overflow-wrap: anywhere; }
.jm-now { margin: 0; font: 650 21px/1.3 var(--serif); text-wrap: balance; }
.jm-now.jm-muted { font: 400 14px/1.5 var(--sans); color: var(--dim); }
.jm-next { margin: 8px 0 0; font: 500 14px/1.4 var(--serif); color: var(--dim); text-wrap: balance; }
/* Small pop-out: only the current line, no upcoming line. */
@container (max-height: 120px) {
  .jm-next { display: none; }
  .jm-now { font-size: 18px; }
}
@container (max-height: 64px) {
  .jm-now { font-size: 15px; line-height: 1.25; }
}
.jm-full { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 -16px; }

/* Full lyrics list (same class names as the side panel, tuned smaller). */
.jsl-body {
  position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 10%, #000 90%, transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0, #000 10%, #000 90%, transparent 100%);
}
.jsl-lines { list-style: none; margin: 0; padding: 30% 0; }
.jsl-lines:empty { padding: 0; }
.jsl-line {
  display: block; width: 100%; margin: 2px 0; padding: 6px 12px;
  font: 500 18px/1.35 var(--serif); text-align: left; color: var(--dim);
  background: transparent; border: 1px solid transparent; border-radius: 12px; cursor: pointer;
  transition: color .25s, background-color .25s, border-color .25s;
}
.jsl-line:hover { color: #fff; }
.jsl-line.jsl-active {
  color: #fff; font-weight: 650; background: rgba(255,255,255,.13); border-color: rgba(255,255,255,.22);
  box-shadow: 0 10px 26px -14px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.18);
}
.jsl-lines.jsl-unsynced { padding: 12px 0 40px; }
.jsl-plain { padding: 2px 12px; font: 400 15px/1.5 var(--serif); color: #fff; cursor: default; }
.jsl-status { margin: 0; padding: 20px 12px; font-size: 13px; line-height: 1.5; color: var(--dim); }
.jsl-status[hidden] { display: none; }

.jm-controls { display: grid; gap: 6px; padding: 8px 16px 14px; background: rgba(255,255,255,.05); border-top: 1px solid rgba(255,255,255,.10); }
.jm-seekrow { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; font-size: 11px; color: var(--dim); font-variant-numeric: tabular-nums; }
.jm-btns { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.jm-transport { display: flex; align-items: center; gap: 6px; }
.jm-vol-group { display: flex; align-items: center; gap: 2px; }
.jm-vol { width: 64px; }

.jm-btn { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; color: #fff; background: transparent; border: 0; border-radius: 50%; cursor: pointer; }
.jm-btn:hover { background: rgba(255,255,255,.16); }
.jm-mute { width: 32px; height: 32px; }
.jm-play { width: 52px; height: 52px; color: #06120f; background: var(--jsl-accent); }
.jm-play:hover { background: var(--jsl-accent); filter: brightness(1.1); }
.jm-btn:focus-visible, .jm-mode button:focus-visible, .jm-range:focus-visible, .jsl-line:focus-visible { outline: 2px solid var(--jsl-accent); outline-offset: 2px; }

.jm-range { -webkit-appearance: none; appearance: none; width: 100%; height: 14px; margin: 0; background: transparent; cursor: pointer; }
.jm-range::-webkit-slider-runnable-track { height: 4px; border-radius: 99px; background: linear-gradient(to right, #fff var(--p, 0%), rgba(255,255,255,.28) var(--p, 0%)); }
.jm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
.jm-range::-moz-range-track { height: 4px; border-radius: 99px; background: rgba(255,255,255,.28); }
.jm-range::-moz-range-progress { height: 4px; border-radius: 99px; background: #fff; }
.jm-range::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: #fff; }

@media (max-width: 320px) { .jm-vol { display: none; } .jm-mode button { padding: 5px 7px; } }
@media (prefers-reduced-motion: reduce) { :root { transition: none; } .jsl-line { transition: none; } }
`;

  function loadMode() {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (MODES.includes(m)) return m;
    } catch (_) {}
    return "line";
  }

  function create(deps) {
    let win = null, doc = null, ui = null;
    let mode = loadMode();
    let seeking = false;
    let duration = 0;
    let last = { playing: null, muted: null };
    let data = { track: null, lines: [], plain: null, status: "", active: -1 };

    const isOpen = () => !!win && !win.closed;

    function build() {
      const H = (...a) => h(doc, ...a);
      const I = (n, s) => icon(doc, n, s);
      doc.body.replaceChildren();
      ui = {};

      ui.cover = H("img", { class: "jm-cover", alt: "", hidden: "" });
      ui.cover.addEventListener("error", () => { ui.cover.hidden = true; });
      ui.title = H("p", { class: "jm-title" }, "Nothing playing");
      ui.artist = H("p", { class: "jm-artist" });

      ui.modeBtns = {};
      const seg = H("div", { class: "jm-mode", role: "group", "aria-label": "Lyrics display" });
      for (const [m, label, tip] of [["off", "Off", "Hide lyrics"], ["line", "Line", "Show the current line"], ["full", "All", "Show all lyrics"]]) {
        const b = H("button", { type: "button", title: tip, "aria-pressed": "false" }, label);
        b.addEventListener("click", () => applyMode(m, true));
        ui.modeBtns[m] = b;
        seg.append(b);
      }

      ui.now = H("p", { class: "jm-now", "aria-live": "off" });
      ui.next = H("p", { class: "jm-next" });
      ui.full = createLyricsView(doc, { onSeek: (t) => deps.controls.seekToLine(t) });
      const lyrics = H("section", { class: "jm-lyrics", "aria-label": "Lyrics" },
        H("div", { class: "jm-line-view" }, ui.now, ui.next),
        H("div", { class: "jm-full" }, ui.full.body));

      const btn = (cls, label, name, size, fn) => {
        const b = H("button", { type: "button", class: `jm-btn ${cls}`.trim(), title: label, "aria-label": label }, I(name, size));
        b.addEventListener("click", fn);
        return b;
      };
      ui.prev = btn("jm-prev", "Previous song", "prev", 22, () => deps.controls.prev());
      ui.play = btn("jm-play", "Play", "play", 26, () => deps.controls.toggle());
      ui.nextBtn = btn("jm-next-btn", "Next song", "next", 22, () => deps.controls.next());
      ui.mute = btn("jm-mute", "Mute", "volume", 18, () => deps.controls.toggleMute());

      const range = (cls, label, max) =>
        H("input", { type: "range", class: `jm-range ${cls}`, min: "0", max: String(max), step: "1", value: "0", "aria-label": label });
      const paint = (r) => r.style.setProperty("--p", `${(Number(r.value) / Number(r.max)) * 100}%`);

      ui.seek = range("jm-seek", "Seek", 1000);
      ui.cur = H("span", { class: "jm-time" }, "0:00");
      ui.dur = H("span", { class: "jm-time" }, "0:00");
      ui.seek.addEventListener("input", () => { seeking = true; paint(ui.seek); ui.cur.textContent = fmt((ui.seek.value / 1000) * duration); });
      ui.seek.addEventListener("change", () => { deps.controls.seek((ui.seek.value / 1000) * duration); seeking = false; });

      ui.vol = range("jm-vol", "Volume", 100);
      ui.vol.value = "100";
      paint(ui.vol);
      ui.vol.addEventListener("input", () => { paint(ui.vol); deps.controls.setVolume(ui.vol.value / 100); });
      ui.paint = paint;

      ui.root = H("div", { class: "jm-root", "data-mode": mode },
        H("header", { class: "jm-top" }, ui.cover, H("div", { class: "jm-meta" }, ui.title, ui.artist), seg),
        lyrics,
        H("footer", { class: "jm-controls" },
          H("div", { class: "jm-seekrow" }, ui.cur, ui.seek, ui.dur),
          H("div", { class: "jm-btns" },
            H("div", { class: "jm-vol-group" }, ui.mute, ui.vol),
            H("div", { class: "jm-transport" }, ui.prev, ui.play, ui.nextBtn),
            H("div", { class: "jm-spacer" }))));
      doc.body.append(ui.root);

      // Space toggles play/pause unless a control already handles the key.
      doc.addEventListener("keydown", (e) => {
        if (e.code !== "Space") return;
        const tag = e.target && e.target.tagName;
        if (tag === "BUTTON" || tag === "INPUT") return;
        e.preventDefault();
        deps.controls.toggle();
      });
    }

    function applyStyles() {
      doc.title = "Saavn mini player";
      try {
        const sheet = new win.CSSStyleSheet(); // adopted sheets are exempt from the site's CSP
        sheet.replaceSync(CSS);
        doc.adoptedStyleSheets = [sheet];
      } catch (_) {
        const style = doc.createElement("style");
        style.textContent = CSS;
        (doc.head || doc.documentElement).append(style);
      }
    }

    function applyMode(m, userInitiated) {
      mode = m;
      try { localStorage.setItem(MODE_KEY, m); } catch (_) {}
      ui.root.setAttribute("data-mode", m);
      for (const [k, b] of Object.entries(ui.modeBtns)) b.setAttribute("aria-pressed", String(k === m));
      renderLine();
      if (m === "full") win.requestAnimationFrame(() => ui.full.reveal());
      if (userInitiated) {
        try { win.resizeTo(win.outerWidth || SIZES[m].w, SIZES[m].h + (win.outerHeight - win.innerHeight || 0)); } catch (_) {}
      }
    }

    function renderLine() {
      if (!ui) return;
      const { lines, plain, status, active } = data;
      ui.now.classList.toggle("jm-muted", !lines.length);
      if (!lines.length) {
        ui.now.textContent = plain ? "These lyrics aren\u2019t timed, so there\u2019s no current line." : status;
        ui.next.textContent = "";
        return;
      }
      const cur = lines[active], nxt = lines[active + 1];
      ui.now.textContent = cur ? cur.text || "\u266a" : "\u266a";
      ui.next.textContent = nxt ? nxt.text || "" : "";
    }

    // ----- data in -----
    function setTrack(track) {
      data.track = track;
      if (!ui) return;
      ui.title.textContent = track ? track.title : "Nothing playing";
      ui.artist.textContent = track ? track.artist : "";
      if (track && track.art) {
        if (ui.cover.getAttribute("src") !== track.art) ui.cover.src = track.art;
        ui.cover.hidden = false;
      } else {
        ui.cover.hidden = true;
      }
    }

    function setTheme(theme) {
      if (!doc) return;
      const s = doc.documentElement.style;
      for (const [k, v] of Object.entries(THEME_VARS)) {
        if (theme && theme[k]) s.setProperty(v, theme[k]); else s.removeProperty(v);
      }
    }

    function setLyrics(l) {
      data.lines = l.lines || [];
      data.plain = l.plain || null;
      data.status = l.status || "";
      data.active = -1;
      if (!ui) return;
      if (data.plain) ui.full.setPlain(data.plain); else ui.full.setLines(data.lines);
      ui.full.setStatus(data.status);
      renderLine();
    }

    function setActive(idx) {
      data.active = idx;
      if (!ui) return;
      ui.full.setActive(idx);
      renderLine();
    }

    function tick(s) {
      if (win && win.closed) return onGone();
      if (!ui) return;
      duration = s.duration || 0;
      if (s.playing !== last.playing) {
        last.playing = s.playing;
        ui.play.replaceChildren(icon(doc, s.playing ? "pause" : "play", 26));
        ui.play.title = s.playing ? "Pause" : "Play";
        ui.play.setAttribute("aria-label", ui.play.title);
      }
      if (!seeking) {
        ui.cur.textContent = fmt(s.time);
        ui.seek.value = String(duration ? Math.min(1000, Math.round((s.time / duration) * 1000)) : 0);
        ui.paint(ui.seek);
      }
      ui.dur.textContent = fmt(duration);
      const shown = s.muted ? 0 : Math.round(s.volume * 100);
      ui.vol.value = String(shown);
      ui.paint(ui.vol);
      if (s.muted !== last.muted) {
        last.muted = s.muted;
        ui.mute.replaceChildren(icon(doc, s.muted ? "mute" : "volume", 18));
        ui.mute.setAttribute("aria-label", s.muted ? "Unmute" : "Mute");
        ui.mute.title = s.muted ? "Unmute" : "Mute";
      }
    }

    // ----- lifecycle -----
    function onGone() {
      if (!win) return;
      win = doc = ui = null;
      last = { playing: null, muted: null };
      if (deps.onClosed) deps.onClosed();
    }

    // Must be called straight from a click: the browser only allows opening the window then.
    async function open() {
      if (isOpen()) { try { win.focus(); } catch (_) {} return; }
      const size = SIZES[mode];
      let w;
      if (root.documentPictureInPicture) {
        w = await root.documentPictureInPicture.requestWindow({ width: size.w, height: size.h });
      } else {
        w = root.open("", "jsl-mini", `popup=yes,width=${size.w},height=${size.h}`);
        if (!w) throw new Error("The browser blocked the pop-up window.");
      }
      win = w;
      doc = w.document;
      applyStyles();
      build();

      const s = deps.snapshot();
      setTrack(s.track);
      setTheme(s.theme);
      setLyrics({ lines: s.lines, plain: s.plain, status: s.status });
      setActive(s.active);
      applyMode(mode, false);
      w.addEventListener("pagehide", onGone);
    }

    function close() {
      const w = win;
      onGone();
      try { w && w.close(); } catch (_) {}
    }

    return { open, close, isOpen, setTrack, setTheme, setLyrics, setActive, tick };
  }

  root.SaavnMini = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
