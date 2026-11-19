// DOM helpers shared by the side panel (main page) and the mini player (pop-out window).
// Every function takes the target `doc`, because the pop-out lives in a different document.
(function (root) {
  "use strict";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function h(doc, tag, attrs, ...kids) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    node.append(...kids);
    return node;
  }

  const ICONS = {
    play: { fill: ["M8 5v14l11-7z"] },
    pause: { fill: ["M6 5h4v14H6zM14 5h4v14h-4z"] },
    prev: { fill: ["M6 6h2v12H6zM9.5 12l8.5 6V6z"] },
    next: { fill: ["M16 6h2v12h-2zM6 18l8.5-6L6 6z"] },
    volume: { fill: ["M3 9v6h4l5 4V5L7 9H3z"], stroke: ["M15.5 8.5a5 5 0 0 1 0 7", "M18 6a8.5 8.5 0 0 1 0 12"] },
    mute: { fill: ["M3 9v6h4l5 4V5L7 9H3z"], stroke: ["M16 9.5l5 5", "M21 9.5l-5 5"] },
    popout: { fill: [], stroke: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"] },
    lyrics: {
      fill: [],
      stroke: [
        "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
        "M8 9h8",
        "M8 13h5"
      ]
    },
    mic: {
      fill: [],
      stroke: [
        "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z",
        "M19 10v2a7 7 0 0 1-14 0v-2",
        "M12 19v3",
        "M8 22h8"
      ]
    },
  };

  function icon(doc, name, size) {
    const spec = ICONS[name];
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 20));
    svg.setAttribute("height", String(size || 20));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of spec.fill) {
      const p = doc.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "currentColor");
      svg.append(p);
    }
    for (const d of spec.stroke || []) {
      const p = doc.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "2");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
      svg.append(p);
    }
    return svg;
  }

  // A scrolling lyrics list with a highlighted current line. Used in both documents.
  function createLyricsView(doc, opts) {
    const pauseMs = (opts && opts.pauseMs) || 4000;
    const onSeek = (opts && opts.onSeek) || (() => {});
    const view = { lines: [], active: -1 };
    let nodes = [];
    let userScrollUntil = 0;

    const list = h(doc, "ol", { class: "jsl-lines" });
    const status = h(doc, "p", { class: "jsl-status", role: "status" });
    const body = h(doc, "div", { class: "jsl-body" }, list, status);
    status.hidden = true;

    list.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest(".jsl-line[data-i]");
      const line = btn && view.lines[Number(btn.dataset.i)];
      if (line) onSeek(line.time);
    });
    // Don't fight the reader: pause auto-scroll briefly after manual scrolling.
    const pause = () => (userScrollUntil = Date.now() + pauseMs);
    body.addEventListener("wheel", pause, { passive: true });
    body.addEventListener("touchmove", pause, { passive: true });

    function scrollTo(node, instant) {
      if (!body.clientHeight) return; // hidden right now; reveal() fixes it when shown
      const top = node.offsetTop - body.clientHeight / 2 + node.offsetHeight / 2;
      const reduce = doc.defaultView && doc.defaultView.matchMedia && doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;
      body.scrollTo({ top, behavior: instant || reduce ? "auto" : "smooth" });
    }

    function setLines(lines) {
      view.lines = lines || [];
      view.active = -1;
      list.classList.remove("jsl-unsynced");
      list.replaceChildren();
      nodes = view.lines.map((l, i) => {
        const btn = h(doc, "button", { type: "button", class: "jsl-line", "data-i": String(i) }, l.text || "\u266a");
        list.append(h(doc, "li", {}, btn));
        return btn;
      });
      body.scrollTop = 0;
    }

    function setPlain(text) {
      view.lines = [];
      view.active = -1;
      nodes = [];
      list.classList.add("jsl-unsynced");
      list.replaceChildren(...String(text || "").split(/\r?\n/).map((t) => h(doc, "li", { class: "jsl-line jsl-plain" }, t || "\u00a0")));
      body.scrollTop = 0;
    }

    function setStatus(text) {
      status.textContent = text || "";
      status.hidden = !text;
    }

    function setActive(idx) {
      if (idx === view.active) return;
      const prev = nodes[view.active];
      if (prev) { prev.classList.remove("jsl-active"); prev.removeAttribute("aria-current"); }
      view.active = idx;
      const cur = nodes[idx];
      if (!cur) return;
      cur.classList.add("jsl-active");
      cur.setAttribute("aria-current", "true");
      if (Date.now() >= userScrollUntil) scrollTo(cur, false);
    }

    // Call after the view becomes visible again so the current line is centred.
    function reveal() {
      const cur = nodes[view.active];
      if (cur) scrollTo(cur, true);
    }

    return { body, setLines, setPlain, setStatus, setActive, reveal, get active() { return view.active; } };
  }

  root.SaavnLyricsUI = { h, icon, createLyricsView };
})(typeof globalThis !== "undefined" ? globalThis : this);
