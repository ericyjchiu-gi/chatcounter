(() => {
  "use strict";
  const PAGE = "CMM_PAGE_V14";
  const EXT = "CMM_EXT_V14";
  const ALLOWED_PREFIX = "cmm_v14_";

  function safeKeys(keys) {
    if (keys == null) return null;
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.filter(k => typeof k === "string" && k.startsWith(ALLOWED_PREFIX));
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== PAGE || !msg.id) return;

    const reply = (ok, result, error) => {
      window.postMessage({ source: EXT, id: msg.id, ok, result, error }, "*");
    };

    try {
      const op = msg.op;
      if (op === "get") {
        const keys = safeKeys(msg.payload?.keys);
        if (msg.payload?.keys != null && (!keys || !keys.length)) throw new Error("No allowed storage keys requested");
        const result = await chrome.storage.local.get(keys);
        reply(true, result);
      } else if (op === "set") {
        const items = msg.payload?.items || {};
        const filtered = {};
        for (const [k, v] of Object.entries(items)) {
          if (k.startsWith(ALLOWED_PREFIX)) filtered[k] = v;
        }
        await chrome.storage.local.set(filtered);
        reply(true, true);
      } else if (op === "remove") {
        const keys = safeKeys(msg.payload?.keys) || [];
        await chrome.storage.local.remove(keys);
        reply(true, true);
      } else if (op === "bytes") {
        const keys = safeKeys(msg.payload?.keys);
        const n = await chrome.storage.local.getBytesInUse(keys);
        reply(true, n);
      } else {
        throw new Error("Unsupported storage operation");
      }
    } catch (e) {
      reply(false, null, e?.message || String(e));
    }
  });
})();
