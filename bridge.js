// Runs in the PAGE's own JS world (manifest "world": "MAIN") at document_start.
// JioSaavn registers Media Session handlers (the ones your keyboard's media keys trigger).
// We remember them so the extension's mini player can call the site's real play / pause /
// next / previous, which keeps the site's own UI in sync. Messages are JSON strings because
// objects don't reliably cross between the page world and the extension world.
(() => {
  "use strict";
  if (window.__jslBridge) return;
  window.__jslBridge = true;

  const MS = window.MediaSession;
  if (!MS || !MS.prototype || !MS.prototype.setActionHandler) return;

  const handlers = Object.create(null);
  const announce = () =>
    window.dispatchEvent(new CustomEvent("jsl:actions", { detail: JSON.stringify(Object.keys(handlers)) }));

  const original = MS.prototype.setActionHandler;
  MS.prototype.setActionHandler = function (action, handler) {
    if (typeof handler === "function") handlers[action] = handler;
    else delete handlers[action];
    announce();
    return original.call(this, action, handler);
  };

  window.addEventListener("jsl:ping", announce);
  window.addEventListener("jsl:action", (e) => {
    let detail;
    try { detail = JSON.parse(e.detail); } catch (_) { return; }
    const fn = detail && handlers[detail.action];
    if (typeof fn !== "function") return;
    try { fn(detail); } catch (err) { console.debug("[Saavn Lyrics] site handler failed:", err); }
  });
})();
