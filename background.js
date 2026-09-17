(() => {
  "use strict";

  const VERSION = "1.6.0";
  const LOCK_KEY = "cmm_v16_sync_lock";
  const ALARM = "cmm_v16_background_reconcile";
  const LIVE_PREFIX = "cmm_v16_live_";
  const LOCK_LEASE_MS = 30 * 60 * 1000;
  const LIVE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

  const now = () => Date.now();
  const token = () => `${now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

  async function getLock() {
    const obj = await chrome.storage.session.get(LOCK_KEY);
    const lock = obj?.[LOCK_KEY] || null;
    if (lock && Number(lock.expiresAt || 0) <= now()) {
      await chrome.storage.session.remove(LOCK_KEY);
      return null;
    }
    return lock;
  }

  async function acquireSync(sender, payload = {}) {
    const tabId = sender?.tab?.id ?? null;
    if (tabId == null) return { acquired:false, reason:"no-tab" };

    const existing = await getLock();
    if (existing) {
      return {
        acquired:false,
        reason:"busy",
        ownerTabId:existing.ownerTabId,
        scope:existing.scope || "",
        startedAt:existing.startedAt || 0,
        expiresAt:existing.expiresAt || 0
      };
    }

    const lock = {
      token: token(),
      ownerTabId: tabId,
      scope: String(payload.scope || ""),
      reason: String(payload.reason || "manual"),
      startedAt: now(),
      expiresAt: now() + LOCK_LEASE_MS
    };
    await chrome.storage.session.set({ [LOCK_KEY]: lock });
    await broadcast({ type:"CMM_BG_EVENT", event:"sync-state", payload:{ running:true, ...lock, token:undefined } });
    return { acquired:true, token:lock.token, ownerTabId:tabId, expiresAt:lock.expiresAt };
  }

  async function renewSync(sender, payload = {}) {
    const tabId = sender?.tab?.id ?? null;
    const lock = await getLock();
    if (!lock || lock.token !== payload.token || lock.ownerTabId !== tabId) return { renewed:false };
    lock.expiresAt = now() + LOCK_LEASE_MS;
    await chrome.storage.session.set({ [LOCK_KEY]: lock });
    return { renewed:true, expiresAt:lock.expiresAt };
  }

  async function releaseSync(sender, payload = {}) {
    const tabId = sender?.tab?.id ?? null;
    const lock = await getLock();
    if (!lock) return { released:true };
    if (payload.force !== true && (lock.token !== payload.token || lock.ownerTabId !== tabId)) {
      return { released:false, reason:"not-owner" };
    }
    await chrome.storage.session.remove(LOCK_KEY);
    await broadcast({
      type:"CMM_BG_EVENT",
      event:"sync-state",
      payload:{ running:false, finishedAt:now(), scope:lock.scope || "", reason:lock.reason || "" }
    });
    return { released:true };
  }

  function normalizeLiveEvent(e) {
    if (!e || !e.id) return null;
    const t = Number(e.t) || 0;
    if (!t) return null;
    return {
      id:String(e.id),
      t,
      model:String(e.model || "unknown"),
      effort:String(e.effort || "")
    };
  }

  async function appendLive(payload = {}) {
    const scope = String(payload.scope || "");
    if (!scope) return { ok:false, reason:"no-scope" };
    const key = `${LIVE_PREFIX}${scope}`;
    const current = (await chrome.storage.local.get(key))?.[key] || { schema:1, events:{}, lastCapture:0 };
    if (!current.events || typeof current.events !== "object") current.events = {};

    const cutoff = now() - LIVE_RETENTION_MS;
    for (const [id, e] of Object.entries(current.events)) {
      if (!e || Number(e.t || 0) < cutoff) delete current.events[id];
    }

    let added = 0;
    for (const raw of (Array.isArray(payload.events) ? payload.events : [])) {
      const e = normalizeLiveEvent(raw);
      if (!e) continue;
      if (!current.events[e.id]) added++;
      current.events[e.id] = e;
    }
    current.lastCapture = now();
    await chrome.storage.local.set({ [key]: current });

    if (added > 0) {
      await broadcast({
        type:"CMM_BG_EVENT",
        event:"live-updated",
        payload:{ scope, added, conversationId:String(payload.conversationId || ""), at:current.lastCapture }
      });
    }
    return { ok:true, added, total:Object.keys(current.events).length };
  }

  async function broadcast(message) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url:["https://chatgpt.com/*"] }); }
    catch (_) { return; }
    await Promise.allSettled(tabs.map(tab => tab.id != null ? chrome.tabs.sendMessage(tab.id, message) : Promise.resolve()));
  }

  async function requestBackgroundReconcile(reason = "alarm") {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url:["https://chatgpt.com/*"] }); }
    catch (_) { return; }
    if (!tabs.length) return;
    tabs.sort((a,b) => Number(b.active) - Number(a.active) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
    const target = tabs[0];
    if (target?.id == null) return;
    try {
      await chrome.tabs.sendMessage(target.id, {
        type:"CMM_BG_EVENT",
        event:"background-reconcile",
        payload:{ reason, at:now(), version:VERSION }
      });
    } catch (_) {}
  }

  chrome.runtime.onInstalled.addListener(async () => {
    try {
      await chrome.alarms.clear(ALARM);
      chrome.alarms.create(ALARM, { periodInMinutes:30 });
    } catch (_) {}
  });

  chrome.runtime.onStartup.addListener(async () => {
    try {
      const alarm = await chrome.alarms.get(ALARM);
      if (!alarm) chrome.alarms.create(ALARM, { periodInMinutes:30 });
    } catch (_) {}
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm?.name === ALARM) requestBackgroundReconcile("alarm");
  });

  chrome.tabs.onRemoved.addListener(async tabId => {
    const lock = await getLock();
    if (lock?.ownerTabId === tabId) {
      await chrome.storage.session.remove(LOCK_KEY);
      await broadcast({ type:"CMM_BG_EVENT", event:"sync-state", payload:{ running:false, interrupted:true, finishedAt:now() } });
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo?.status !== "loading") return;
    const lock = await getLock();
    if (lock?.ownerTabId === tabId) {
      await chrome.storage.session.remove(LOCK_KEY);
      await broadcast({ type:"CMM_BG_EVENT", event:"sync-state", payload:{ running:false, interrupted:true, finishedAt:now() } });
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "CMM_PAGE_BG") return;
    (async () => {
      switch (msg.action) {
        case "acquire-sync": return acquireSync(sender, msg.payload);
        case "renew-sync": return renewSync(sender, msg.payload);
        case "release-sync": return releaseSync(sender, msg.payload);
        case "get-sync-state": return { lock: await getLock() };
        case "append-live": return appendLive(msg.payload);
        case "request-background-reconcile": await requestBackgroundReconcile(msg.payload?.reason || "manual"); return { ok:true };
        default: throw new Error(`Unknown background action: ${msg.action}`);
      }
    })().then(sendResponse).catch(e => sendResponse({ error:e?.message || String(e) }));
    return true;
  });
})();
