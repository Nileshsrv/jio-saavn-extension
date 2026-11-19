(() => {
  "use strict";

  const DEFAULTS = {
    themeEnabled: true,
    ambianceEnabled: true,
    cleanEnabled: true,
  };

  const els = {
    themeEnabled: document.getElementById("pref-theme"),
    ambianceEnabled: document.getElementById("pref-ambiance"),
    cleanEnabled: document.getElementById("pref-clean"),
    btnLyrics: document.getElementById("btn-lyrics"),
  };

  chrome.storage.local.get(DEFAULTS, (res) => {
    for (const [k, el] of Object.entries(els)) {
      if (el && el.type === "checkbox") el.checked = res[k] !== false;
    }
  });

  for (const key of Object.keys(DEFAULTS)) {
    els[key].addEventListener("change", () => {
      chrome.storage.local.set({ [key]: els[key].checked });
    });
  }

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const isSaavn = tab && tab.url && /^https:\/\/([^/]+\.)?jiosaavn\.com\//i.test(tab.url);
    if (!isSaavn) {
      els.btnLyrics.textContent = "Open JioSaavn";
      els.btnLyrics.addEventListener("click", () => {
        chrome.tabs.create({ url: "https://www.jiosaavn.com/" });
        window.close();
      });
      return;
    }

    els.btnLyrics.addEventListener("click", () => {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_LYRICS" }, () => {
        if (chrome.runtime.lastError) {
          chrome.tabs.reload(tab.id);
        }
        window.close();
      });
    });
  });
})();
