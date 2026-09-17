(() => {
  "use strict";
  const PAGE = "CMM_PAGE_V16";
  const EXT = "CMM_EXT_V16";
  const ALLOWED_PREFIXES = ["cmm_v14_", "cmm_v16_"];

  const allowedKey = k => typeof k === "string" && ALLOWED_PREFIXES.some(p => k.startsWith(p));
  function safeKeys(keys) {
    if (keys == null) return null;
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.filter(allowedKey);
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.type !== "CMM_BG_EVENT") return;
    window.postMessage({ source:EXT, type:"event", event:msg.event, payload:msg.payload || {} }, "*");
  });

  window.addEventListener("message", async event => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== PAGE || !msg.id) return;

    const reply = (ok, result, error) => {
      window.postMessage({ source:EXT, id:msg.id, ok, result, error }, "*");
    };

    try {
      const op = msg.op;
      if (op === "get") {
        const keys = safeKeys(msg.payload?.keys);
        if (msg.payload?.keys != null && (!keys || !keys.length)) throw new Error("No allowed storage keys requested");
        reply(true, await chrome.storage.local.get(keys));
      } else if (op === "set") {
        const items = msg.payload?.items || {};
        const filtered = {};
        for (const [k,v] of Object.entries(items)) if (allowedKey(k)) filtered[k] = v;
        await chrome.storage.local.set(filtered);
        reply(true, true);
      } else if (op === "remove") {
        const keys = safeKeys(msg.payload?.keys) || [];
        await chrome.storage.local.remove(keys);
        reply(true, true);
      } else if (op === "bytes") {
        const keys = safeKeys(msg.payload?.keys);
        reply(true, await chrome.storage.local.getBytesInUse(keys));
      } else if (op === "bg") {
        const res = await chrome.runtime.sendMessage({
          type:"CMM_PAGE_BG",
          action:String(msg.payload?.action || ""),
          payload:msg.payload?.payload || {}
        });
        if (res?.error) throw new Error(res.error);
        reply(true, res);
      } else {
        throw new Error("Unsupported bridge operation");
      }
    } catch (e) {
      reply(false, null, e?.message || String(e));
    }
  });
})();
