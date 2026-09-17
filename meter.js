(() => {
  "use strict";

  const VERSION = "1.4.1";
  const ROOT_ID = "cmm-root-v141";
  const LAUNCHER_ID = "cmm-launcher-v141";
  const PAGE_CHANNEL = "CMM_PAGE_V14";
  const EXT_CHANNEL = "CMM_EXT_V14";
  const DAY = 86400000;
  const HOUR = 3600000;
  const RETENTION_DAYS = 90;
  const INITIAL_DISCOVERY_DAYS = 32;
  const REQUEST_GAP_MS = 260;

  const SERIES = [
    { key: "gpt56", label: "GPT-5.6", color: "#20b486" },
    { key: "gpt56pro", label: "GPT-5.6 Pro", color: "#4d8dff" },
    { key: "gpt6pro", label: "GPT-6 Pro", color: "#aa6cff" }
  ];

  const RANGE = {
    "24h": { label: "24 HOURS", duration: DAY, bucketMs: HOUR, buckets: 24 },
    "7d":  { label: "7 DAYS", duration: 7 * DAY, bucketMs: 6 * HOUR, buckets: 28 },
    "30d": { label: "30 DAYS", duration: 30 * DAY, bucketMs: DAY, buckets: 30 }
  };

  if (document.getElementById(LAUNCHER_ID)) return;

  const SYNC_GATE = window.__CMM_SYNC_GATE_V141__ || (window.__CMM_SYNC_GATE_V141__ = {
    running: false,
    promise: null,
    startedAt: 0,
    lastFinishedAt: 0
  });
  const AUTO_SYNC_COOLDOWN_MS = 15 * 60 * 1000;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let rpcSeq = 0;
  function storageCall(op, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `cmm-${Date.now()}-${++rpcSeq}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Extension storage bridge timed out"));
      }, 8000);
      function onMessage(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== EXT_CHANNEL || msg.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error || "Storage operation failed"));
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ source: PAGE_CHANNEL, id, op, payload }, "*");
    });
  }

  async function hashShort(value) {
    try {
      const bytes = new TextEncoder().encode(String(value));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("");
    } catch (_) {
      let h = 2166136261;
      for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    }
  }

  const keyFor = (kind, scope) => `cmm_v14_${kind}_${scope}`;
  const LAST_SCOPE_KEY = "cmm_v14_last_scope";
  function emptyCache() { return { schema: 1, lastSync: 0, conversations: {} }; }
  function sanitizeCache(v) {
    if (!v || v.schema !== 1 || typeof v.conversations !== "object") return emptyCache();
    return v;
  }
  const defaultSettings = () => ({
    resetLocal: "",
    resetTz: (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
      catch { return "UTC"; }
    })(),
    gpt6Cap: 200
  });

  async function loadScopeData(scope) {
    const cacheKey = keyFor("cache", scope);
    const settingsKey = keyFor("settings", scope);
    const obj = await storageCall("get", { keys: [cacheKey, settingsKey] });
    const settings = { ...defaultSettings(), ...(obj?.[settingsKey] || {}) };
    if (!obj?.[settingsKey]) {
      const oldReset = localStorage.getItem("cmm_reset_local") || "";
      const oldTz = localStorage.getItem("cmm_reset_tz") || settings.resetTz;
      const oldCap = Number(localStorage.getItem("cmm_gpt6_cap") || 200);
      if (oldReset || oldTz || oldCap !== 200) {
        settings.resetLocal = oldReset;
        settings.resetTz = oldTz;
        settings.gpt6Cap = Number.isFinite(oldCap) && oldCap > 0 ? oldCap : 200;
        await storageCall("set", { items: { [settingsKey]: settings } });
      }
    }
    return { cache: sanitizeCache(obj?.[cacheKey]), settings, cacheKey, settingsKey };
  }
  async function saveSettings(settingsKey, settings) {
    await storageCall("set", { items: { [settingsKey]: settings } });
  }
  function pruneCache(cache, now = Date.now(), days = RETENTION_DAYS) {
    const cutoff = now - days * DAY;
    const next = { schema: 1, lastSync: cache.lastSync || 0, conversations: {} };
    for (const [id, c] of Object.entries(cache.conversations || {})) {
      const events = Array.isArray(c.events) ? c.events.filter(e => e && e.t >= cutoff) : [];
      const u = Number(c.u) || 0;
      if (events.length || u >= cutoff) next.conversations[id] = { u, source: c.source || "unknown", events };
    }
    return next;
  }
  async function saveCache(cacheKey, cache) {
    cache = pruneCache(cache);
    try {
      await storageCall("set", { items: { [cacheKey]: cache } });
      return cache;
    } catch (e) {
      if (/quota|QUOTA_BYTES|MAX_WRITE/i.test(e.message || "")) {
        cache = pruneCache(cache, Date.now(), 45);
        await storageCall("set", { items: { [cacheKey]: cache } });
        return cache;
      }
      throw e;
    }
  }

  function epochFromAny(v) {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v > 1e12) return v;
      if (v > 1e9) return v * 1000;
      return null;
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 1e9) return epochFromAny(n);
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  }
  function fmtEpoch(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString(undefined, {
      year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit", timeZoneName:"short"
    });
  }
  function fmtShortTime(ts, rangeKey) {
    const d = new Date(ts);
    if (rangeKey === "24h") return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    if (rangeKey === "7d") return d.toLocaleDateString([], {weekday:"short", day:"numeric"});
    return d.toLocaleDateString([], {month:"short", day:"numeric"});
  }
  function getZonedParts(epoch, timeZone) {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
    });
    const p = {};
    for (const x of f.formatToParts(new Date(epoch))) if (x.type !== "literal") p[x.type] = x.value;
    return {year:+p.year, month:+p.month, day:+p.day, hour:+p.hour, minute:+p.minute, second:+p.second};
  }
  function zonedLocalToEpoch(localValue, timeZone) {
    const m = String(localValue || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) throw new Error("Reset time must be YYYY-MM-DDTHH:mm.");
    const target = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6] || 0));
    let guess = target;
    for (let i=0; i<4; i++) {
      const p = getZonedParts(guess, timeZone);
      const represented = Date.UTC(p.year, p.month-1, p.day, p.hour, p.minute, p.second);
      const diff = target - represented;
      if (Math.abs(diff) < 1000) break;
      guess += diff;
    }
    return guess;
  }
  function normalizedNextReset(resetLocal, timeZone) {
    if (!resetLocal) return null;
    let t = zonedLocalToEpoch(resetLocal, timeZone);
    const now = Date.now();
    while (t <= now) t += 7 * DAY;
    while (t - now > 7 * DAY) t -= 7 * DAY;
    return t;
  }

  let AUTH_TOKEN = null;
  let AUTH_SCOPE = null;
  let nextRequestAt = 0;
  async function initAuth() {
    const r = await fetch("/api/auth/session", {method:"GET", credentials:"include", cache:"no-store", headers:{"accept":"application/json"}});
    if (!r.ok) throw new Error(`Session endpoint HTTP ${r.status}`);
    const j = await r.json();
    AUTH_TOKEN = j?.accessToken || j?.access_token || null;
    if (!AUTH_TOKEN) throw new Error("No accessToken returned by /api/auth/session. Refresh ChatGPT and sign in again.");
    const stableId = j?.account?.id || j?.account_id || j?.user?.account_id || j?.user?.id || j?.user?.email || "default";
    AUTH_SCOPE = await hashShort(stableId);
    return AUTH_SCOPE;
  }
  async function pace() {
    const now = Date.now();
    if (nextRequestAt > now) await sleep(nextRequestAt - now);
    nextRequestAt = Date.now() + REQUEST_GAP_MS;
  }
  function retryAfterMs(r, attempt) {
    const h = r.headers.get("retry-after");
    if (h) {
      const sec = Number(h);
      if (Number.isFinite(sec)) return Math.max(1000, sec * 1000);
      const at = Date.parse(h);
      if (Number.isFinite(at)) return Math.max(1000, at - Date.now());
    }
    const base = [2500, 5000, 10000, 20000, 40000][Math.min(attempt, 4)];
    return base + Math.floor(Math.random() * 900);
  }
  async function getJSON(url, { maxRetries = 4 } = {}) {
    if (!AUTH_TOKEN) await initAuth();
    let reauthed = false;
    for (let attempt=0; ; attempt++) {
      await pace();
      const r = await fetch(url, {method:"GET", credentials:"include", cache:"no-store", headers:{"accept":"application/json", "authorization":`Bearer ${AUTH_TOKEN}`}});
      if (r.status === 401 && !reauthed) {
        reauthed = true;
        AUTH_TOKEN = null;
        await initAuth();
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && attempt < maxRetries) {
        const wait = retryAfterMs(r, attempt);
        nextRequestAt = Math.max(nextRequestAt, Date.now() + wait);
        await sleep(wait);
        continue;
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        const e = new Error(`HTTP ${r.status} — ${url}${text ? " — " + text.slice(0,160) : ""}`);
        e.status = r.status;
        throw e;
      }
      return r.json();
    }
  }

  function listItems(j) {
    if (Array.isArray(j)) return j;
    for (const k of ["items","conversations","data"]) if (Array.isArray(j?.[k])) return j[k];
    return [];
  }
  function msgEpoch(m) { return epochFromAny(m?.create_time ?? m?.created_at ?? m?.update_time ?? m?.updated_at ?? m?.metadata?.create_time ?? m?.metadata?.timestamp); }
  function convEpoch(c) { return epochFromAny(c?.update_time ?? c?.updated_at ?? c?.create_time ?? c?.created_at) || 0; }
  function modelIdentity(m) {
    const md = m?.metadata || {};
    let model = md.resolved_model_slug ?? md.model_slug ?? md.requested_model_slug ?? md.default_model_slug ?? m?.model_slug ?? "unknown";
    let effort = md.reasoning_effort ?? md.thinking_effort ?? md.effort ?? md.reasoning?.effort ?? md.thinking?.effort ?? "";
    model = String(model || "unknown").trim() || "unknown";
    effort = String(effort || "").trim();
    return {model, effort};
  }
  function isVisibleCompletedAssistant(m) {
    if (!m || m.author?.role !== "assistant" || m.end_turn !== true) return false;
    const md = m.metadata || {};
    if (md.is_visually_hidden_from_conversation === true || md.is_visually_hidden === true || md.hidden === true) return false;
    if (m.recipient && m.recipient !== "all") return false;
    return true;
  }
  function extractTurns(conv, scanStart, scanEnd) {
    const out = [];
    const push = (m, fallbackId="") => {
      if (!isVisibleCompletedAssistant(m)) return;
      const t = msgEpoch(m);
      if (!t || t < scanStart || t > scanEnd) return;
      const {model, effort} = modelIdentity(m);
      out.push({id:String(m.id || fallbackId || `${t}:${model}:${effort}`), t, model, effort});
    };
    if (Array.isArray(conv?.messages)) for (const m of conv.messages) push(m);
    if (conv?.mapping && typeof conv.mapping === "object") for (const [nodeId,node] of Object.entries(conv.mapping)) push(node?.message, nodeId);
    return out;
  }
  async function fetchConversationTurns(id, scanStart, scanEnd) {
    const uniq = new Map();
    let before = null;
    let usedNew = false;
    try {
      for (let page=0; page<80; page++) {
        const p = new URLSearchParams({include_has_versions:"true", num_turns:"100"});
        if (before) p.set("before", before);
        const conv = await getJSON(`/backend-api/conversations/${encodeURIComponent(id)}?${p.toString()}`, {maxRetries:4});
        usedNew = true;
        for (const t of extractTurns(conv, scanStart, scanEnd)) uniq.set(t.id, t);
        let oldest = Infinity;
        for (const m of (Array.isArray(conv?.messages) ? conv.messages : [])) {
          const t = msgEpoch(m); if (t) oldest = Math.min(oldest, t);
        }
        const pi = conv?.page_info || {};
        if (!pi.has_previous_page) break;
        if (Number.isFinite(oldest) && oldest < scanStart) break;
        const next = pi.start_cursor || pi.startCursor || null;
        if (!next || next === before) break;
        before = next;
      }
    } catch (e) {
      if (usedNew) throw e;
    }
    if (!usedNew) {
      const conv = await getJSON(`/backend-api/conversation/${encodeURIComponent(id)}`, {maxRetries:3});
      for (const t of extractTurns(conv, scanStart, scanEnd)) uniq.set(t.id, t);
    }
    return [...uniq.values()];
  }
  function upsertRemote(map, id, u, source) {
    if (!id) return;
    id = String(id);
    const prev = map.get(id);
    if (!prev || (u || 0) > (prev.u || 0)) map.set(id, {id, u:u || 0, source});
  }
  async function discoverRecentConversations(scanStart, onProgress) {
    const map = new Map();
    const stats = {regular:0, archived:0, project:0, projects:0, pages:0};
    const pageSize = 100;
    async function scanRegular(label, archived) {
      for (let page=0; page<50; page++) {
        onProgress(`Listing ${label} conversations… page ${page+1}`);
        const qs = new URLSearchParams({offset:String(page*pageSize), limit:String(pageSize), order:"updated", is_archived:archived ? "true" : "false"});
        const j = await getJSON(`/backend-api/conversations?${qs.toString()}`, {maxRetries:4});
        stats.pages++;
        const items = listItems(j);
        if (!items.length) break;
        let oldest = Infinity;
        for (const c of items) {
          const id = c.id ?? c.conversation_id;
          const u = convEpoch(c);
          if (u) oldest = Math.min(oldest, u);
          if (!u || u >= scanStart) {
            upsertRemote(map, id, u, label);
            if (archived) stats.archived++; else stats.regular++;
          }
        }
        if (items.length < pageSize) break;
        if (Number.isFinite(oldest) && oldest < scanStart) break;
      }
    }
    await scanRegular("regular", false);
    try { await scanRegular("archived", true); } catch (e) { console.warn("[CMM] archived discovery", e); }
    try {
      const projectIds = new Set();
      let cursor = "0";
      for (let page=0; page<20; page++) {
        onProgress(`Discovering Projects… page ${page+1}`);
        const qs = new URLSearchParams({owned_only:"true", cursor:String(cursor)});
        const j = await getJSON(`/backend-api/gizmos/snorlax/sidebar?${qs.toString()}`, {maxRetries:3});
        const walk = (v, depth=0) => {
          if (depth > 7 || v == null) return;
          if (typeof v === "string") { if (v.startsWith("g-p-")) projectIds.add(v); return; }
          if (Array.isArray(v)) { for (const x of v) walk(x, depth+1); return; }
          if (typeof v === "object") {
            for (const [k,x] of Object.entries(v)) {
              if ((k === "id" || k === "gizmo_id" || k === "conversation_template_id") && typeof x === "string" && x.startsWith("g-p-")) projectIds.add(x);
              if (depth < 3 || ["items","gizmo","gizmos","projects","project","data"].includes(k)) walk(x, depth+1);
            }
          }
        };
        walk(j);
        const next = j?.cursor ?? j?.next_cursor ?? null;
        if (!next || next === cursor) break;
        cursor = next;
      }
      stats.projects = projectIds.size;
      let pi = 0;
      for (const projectId of projectIds) {
        pi++;
        let cursor = "0";
        for (let page=0; page<50; page++) {
          onProgress(`Listing Project chats… ${pi}/${projectIds.size}, page ${page+1}`);
          const qs = new URLSearchParams({cursor:String(cursor)});
          const j = await getJSON(`/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?${qs.toString()}`, {maxRetries:3});
          const items = listItems(j);
          if (!items.length) break;
          let oldest = Infinity;
          for (const c of items) {
            const id = c.id ?? c.conversation_id;
            const u = convEpoch(c);
            if (u) oldest = Math.min(oldest, u);
            if (!u || u >= scanStart) { upsertRemote(map, id, u, "project"); stats.project++; }
          }
          const next = j?.cursor ?? j?.next_cursor ?? null;
          if (!next || next === cursor) break;
          if (Number.isFinite(oldest) && oldest < scanStart) break;
          cursor = next;
        }
      }
    } catch (e) {
      console.warn("[CMM] Project discovery skipped", e);
    }
    const current = location.pathname.match(/^\/c\/([A-Za-z0-9-]+)/)?.[1];
    if (current && !map.has(current)) upsertRemote(map, current, 0, "current-url");
    return {items:[...map.values()], stats, currentId:current || null};
  }

  function allEvents(cache) {
    const uniq = new Map();
    for (const c of Object.values(cache.conversations || {})) {
      for (const e of (Array.isArray(c.events) ? c.events : [])) if (e?.id && e?.t) uniq.set(e.id, e);
    }
    return [...uniq.values()].sort((a,b) => a.t - b.t);
  }
  function familyKey(model) {
    const s = String(model || "").toLowerCase().replaceAll("_", "-");
    if (s === "gpt-6-pro" || s.startsWith("gpt-6-pro-")) return "gpt6pro";
    if (s.startsWith("gpt-5-6") && /(^|-)pro($|-)/.test(s)) return "gpt56pro";
    if (s.startsWith("gpt-5-6")) return "gpt56";
    return null;
  }
  function countFamily(events, start, end, key) {
    let n = 0;
    for (const e of events) if (e.t >= start && e.t <= end && familyKey(e.model) === key) n++;
    return n;
  }
  function rangeWindow(rangeKey, now = Date.now()) {
    const c = RANGE[rangeKey] || RANGE["7d"];
    const d = new Date(now);
    let end;
    if (rangeKey === "24h") { d.setMinutes(0,0,0); d.setHours(d.getHours()+1); end = d.getTime(); }
    else if (rangeKey === "7d") { d.setMinutes(0,0,0); d.setHours(Math.floor(d.getHours()/6)*6 + 6); end = d.getTime(); }
    else { d.setHours(0,0,0,0); d.setDate(d.getDate()+1); end = d.getTime(); }
    return {start:end - c.buckets * c.bucketMs, end, ...c};
  }
  function bucketSeries(events, rangeKey) {
    const w = rangeWindow(rangeKey);
    const rows = Array.from({length:w.buckets}, (_,i) => ({start:w.start + i*w.bucketMs, end:w.start + (i+1)*w.bucketMs, gpt56:0, gpt56pro:0, gpt6pro:0}));
    for (const e of events) {
      if (e.t < w.start || e.t >= w.end) continue;
      const key = familyKey(e.model);
      if (!key) continue;
      const i = Math.min(w.buckets-1, Math.max(0, Math.floor((e.t - w.start) / w.bucketMs)));
      rows[i][key]++;
    }
    return {w, rows};
  }
  function rawAggregate(events, start, end) {
    const last24 = Date.now() - DAY;
    const m = new Map();
    for (const e of events) {
      const key = `${e.model}\u0000${e.effort || ""}`;
      if (!m.has(key)) m.set(key, {model:e.model, effort:e.effort || "", count:0, last24:0, last:0});
      const g = m.get(key);
      if (e.t >= start && e.t <= end) { g.count++; g.last = Math.max(g.last, e.t); }
      if (e.t >= last24) g.last24++;
    }
    return [...m.values()].filter(g => g.count || g.last24).sort((a,b) => b.count-a.count || b.last24-a.last24);
  }
  function bytesHuman(n) {
    if (n == null) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
    return `${(n/1024/1024).toFixed(2)} MB`;
  }
  function renderLineChart(container, events, rangeKey) {
    const {rows} = bucketSeries(events, rangeKey);
    const W = 800, H = 245, L = 42, R = 12, T = 18, B = 34;
    const plotW = W-L-R, plotH = H-T-B;
    const maxVal = Math.max(1, ...rows.flatMap(r => SERIES.map(s => r[s.key])));
    const niceMax = Math.max(4, Math.ceil(maxVal / 4) * 4);
    const x = i => L + (rows.length <= 1 ? 0 : i * plotW / (rows.length - 1));
    const y = v => T + plotH - (v / niceMax) * plotH;
    const grid = [0, .25, .5, .75, 1].map(fr => {
      const val = Math.round(niceMax * fr), yy = y(val);
      return `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#292929" stroke-width="1"/><text x="${L-8}" y="${yy+4}" fill="#777" font-size="10" text-anchor="end">${val}</text>`;
    }).join("");
    const lines = SERIES.map(s => {
      const pts = rows.map((r,i) => `${x(i).toFixed(1)},${y(r[s.key]).toFixed(1)}`).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join("");
    const tickCount = rangeKey === "24h" ? 6 : rangeKey === "7d" ? 7 : 6;
    const ticks = Array.from({length:tickCount}, (_,k) => {
      const i = Math.min(rows.length-1, Math.round(k*(rows.length-1)/(tickCount-1))), xx = x(i);
      return `<text x="${xx}" y="${H-10}" fill="#777" font-size="10" text-anchor="middle">${esc(fmtShortTime(rows[i].start, rangeKey))}</text>`;
    }).join("");
    container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="245" role="img" aria-label="ChatGPT message trend">${grid}${lines}${ticks}</svg><div style="display:flex;gap:16px;flex-wrap:wrap;margin:-2px 0 2px 42px">${SERIES.map(s => `<span style="display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:11px"><i style="display:inline-block;width:18px;height:2px;background:${s.color};border-radius:2px"></i>${s.label}</span>`).join("")}</div>`;
  }

  const launcher = document.createElement("button");
  launcher.id = LAUNCHER_ID;
  launcher.textContent = "Meter";
  launcher.title = "Open ChatGPT Message Meter";
  launcher.style.cssText = ["position:fixed","right:16px","bottom:16px","z-index:2147483646","border:1px solid #383838","border-radius:999px","padding:8px 12px","background:#171717","color:#f2f2f2","box-shadow:0 5px 20px rgba(0,0,0,.25)","font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif","cursor:pointer"].join(";");
  document.documentElement.appendChild(launcher);

  function makePanel() {
    const old = document.getElementById(ROOT_ID);
    if (old) { old.remove(); return null; }
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText = ["position:fixed","right:14px","top:14px","z-index:2147483647","width:min(900px,calc(100vw - 28px))","max-height:calc(100vh - 28px)","overflow:auto","background:#101010","color:#f2f2f2","border:1px solid #343434","border-radius:16px","box-shadow:0 24px 80px rgba(0,0,0,.55)","font:13px/1.42 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"].join(";");
    root.innerHTML = `
      <div style="position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:13px 16px;background:#101010;border-bottom:1px solid #2b2b2b"><div><div style="font-weight:760;font-size:15px">ChatGPT Message Meter</div><div style="font-size:11px;color:#767676">v${VERSION} · cached incremental analytics</div></div><div style="display:flex;gap:8px"><button data-act="settings" class="cmm-link">Settings</button><button data-act="close" class="cmm-close">×</button></div></div>
      <style>#${ROOT_ID} .cmm-link{all:unset;cursor:pointer;color:#aaa;padding:4px 7px}#${ROOT_ID} .cmm-close{all:unset;cursor:pointer;color:#aaa;font-size:22px;line-height:1;padding:0 3px}#${ROOT_ID} .cmm-btn{border:1px solid #3a3a3a;background:#1c1c1c;color:#ddd;border-radius:9px;padding:7px 10px;cursor:pointer;font:inherit}#${ROOT_ID} .cmm-btn:disabled{opacity:.45;cursor:default}#${ROOT_ID} .cmm-range{border:1px solid #333;background:#171717;color:#888;border-radius:8px;padding:6px 10px;cursor:pointer;font:700 11px/1.2 inherit}#${ROOT_ID} .cmm-range.on{background:#ececec;color:#111;border-color:#ececec}#${ROOT_ID} .cmm-card{border:1px solid #2e2e2e;border-radius:11px;padding:11px 12px;background:#111}#${ROOT_ID} input{font:inherit}</style>
      <div data-view="main" style="padding:15px 16px 16px"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div data-status style="color:#aaa">Loading local cache…</div><div data-cacheinfo style="font-size:11px;color:#666"></div></div><div style="display:flex;gap:7px;margin-bottom:12px"><button class="cmm-range" data-range="24h">24 HOURS</button><button class="cmm-range" data-range="7d">7 DAYS</button><button class="cmm-range" data-range="30d">30 DAYS</button></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:11px">${SERIES.map(s => `<div class="cmm-card"><div style="display:flex;align-items:center;gap:7px;font-size:11px;color:#888"><i style="width:8px;height:8px;background:${s.color};border-radius:50%"></i>${s.label}</div><div data-card="${s.key}" style="font-size:27px;font-weight:760;margin-top:4px">—</div></div>`).join("")}</div><div class="cmm-card" style="margin-bottom:11px"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div style="font-weight:700">Usage trend</div><div data-range-label style="font-size:11px;color:#777"></div></div><div data-chart style="margin-top:2px"></div></div><div class="cmm-card" style="margin-bottom:11px"><div style="font-weight:700;margin-bottom:5px">GPT-6 Pro quota safety view</div><div data-quota style="color:#bbb;white-space:pre-line"></div></div><div style="overflow:auto;border:1px solid #2e2e2e;border-radius:11px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:#858585;background:#171717"><th style="padding:8px 9px">Raw model slug</th><th style="padding:8px 9px">Effort</th><th style="padding:8px 9px;text-align:right">Selected range</th><th style="padding:8px 9px;text-align:right">24h</th><th style="padding:8px 9px">Last used</th></tr></thead><tbody data-tbody><tr><td colspan="5" style="padding:14px;color:#777">No cached data yet.</td></tr></tbody></table></div><details style="margin-top:10px;border:1px solid #292929;border-radius:9px;padding:8px 10px"><summary style="cursor:pointer;color:#888">Sync diagnostics</summary><pre data-diag style="white-space:pre-wrap;word-break:break-word;color:#777;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;margin:8px 0 0">No sync yet.</pre></details><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button data-act="sync" class="cmm-btn">Sync now</button><button data-act="csv" class="cmm-btn">Export CSV</button></div><div data-progress style="margin-top:9px;color:#666;font-size:11px"></div></div>
      <div data-view="settings" style="display:none;padding:15px 16px 16px"><div style="font-weight:720;margin-bottom:12px">Quota assumptions & local cache</div><label style="display:block;color:#aaa;margin-bottom:5px">Assumed next weekly reset (optional)</label><input data-reset type="datetime-local" step="60" style="width:100%;background:#171717;color:#eee;border:1px solid #383838;border-radius:8px;padding:8px;margin-bottom:9px"><label style="display:block;color:#aaa;margin-bottom:5px">Timezone (IANA)</label><input data-tz type="text" placeholder="Europe/London" style="width:100%;background:#171717;color:#eee;border:1px solid #383838;border-radius:8px;padding:8px;margin-bottom:6px"><div style="color:#6f6f6f;font-size:11px;margin-bottom:12px">This anchor is explicitly an assumption unless ChatGPT exposes its own reset. It can be set to the Codex reset for comparison, but the rolling 7-day lower bound does not depend on it.</div><label style="display:block;color:#aaa;margin-bottom:5px">GPT-6 Pro weekly cap</label><input data-cap type="number" min="1" step="1" style="width:100%;background:#171717;color:#eee;border:1px solid #383838;border-radius:8px;padding:8px;margin-bottom:14px"><div style="display:flex;gap:8px;flex-wrap:wrap"><button data-act="saveSettings" class="cmm-btn" style="background:#eee;color:#111">Save</button><button data-act="clearReset" class="cmm-btn">Clear reset assumption</button><button data-act="clearCache" class="cmm-btn">Clear local cache</button><button data-act="back" class="cmm-btn">Back</button></div><div style="margin-top:14px;padding-top:11px;border-top:1px solid #292929;color:#666;font-size:11px">Cache stores only message metadata (ID, timestamp, model, effort) plus conversation update timestamps in chrome.storage.local. The ChatGPT access token stays in memory and is never written to storage.</div></div>`;
    document.documentElement.appendChild(root);
    return root;
  }

  launcher.addEventListener("click", async () => {
    const root = makePanel();
    if (!root) return;
    const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
    const statusEl=q("[data-status]"),cacheInfoEl=q("[data-cacheinfo]"),chartEl=q("[data-chart]"),quotaEl=q("[data-quota]"),tbody=q("[data-tbody]"),diagEl=q("[data-diag]"),progressEl=q("[data-progress]"),rangeLabelEl=q("[data-range-label]"),mainView=q('[data-view="main"]'),settingsView=q('[data-view="settings"]'),resetInput=q("[data-reset]"),tzInput=q("[data-tz]"),capInput=q("[data-cap]");
    let scope=null, cache=emptyCache(), settings=defaultSettings(), cacheKey=null, settingsKey=null, events=[], selectedRange="24h";
    const show=view=>{mainView.style.display=view==="main"?"":"none";settingsView.style.display=view==="settings"?"":"none";};
    q('[data-act="close"]').onclick=()=>root.remove();
    q('[data-act="settings"]').onclick=()=>{fillSettings();show("settings");};
    q('[data-act="back"]').onclick=()=>show("main");
    function fillSettings(){resetInput.value=settings.resetLocal||"";tzInput.value=settings.resetTz||defaultSettings().resetTz;capInput.value=String(settings.gpt6Cap||200);}
    async function ensureScopeLoaded(){if(scope&&cacheKey&&settingsKey)return;const actualScope=await initAuth();scope=actualScope;await storageCall("set",{items:{[LAST_SCOPE_KEY]:scope}});({cache,settings,cacheKey,settingsKey}=await loadScopeData(scope));events=allEvents(cache);fillSettings();render();}
    function selectedWindow(){return rangeWindow(selectedRange);}
    async function refreshCacheInfo(){if(!cacheKey)return;let n=null;try{n=new Blob([JSON.stringify(cache||{}),JSON.stringify(settings||{})]).size;}catch(_){}const convs=Object.keys(cache.conversations||{}).length;cacheInfoEl.textContent=`Local cache ${bytesHuman(n)} · ${convs} conversations · ${events.length} turns`;}
    function render(){
      events=allEvents(cache);const rangeKey=selectedRange,w=selectedWindow();qa("[data-range]").forEach(b=>b.classList.toggle("on",b.dataset.range===rangeKey));rangeLabelEl.textContent=RANGE[rangeKey].label;
      for(const s of SERIES)q(`[data-card="${s.key}"]`).textContent=String(countFamily(events,w.start,w.end,s.key));
      renderLineChart(chartEl,events,rangeKey);
      const cap=Math.max(1,Number(settings.gpt6Cap||200)),now=Date.now(),rolling=countFamily(events,now-7*DAY,now,"gpt6pro"),guaranteed=Math.max(0,cap-rolling);
      let quotaText=`Rolling 7-day usage: ${rolling} messages\nGuaranteed remaining: ≥ ${guaranteed} / ${cap}`;
      if(settings.resetLocal){try{const nextReset=normalizedNextReset(settings.resetLocal,settings.resetTz),start=nextReset-7*DAY,anchored=countFamily(events,start,Math.min(now,nextReset),"gpt6pro");quotaText+=`\nAssumed anchored window: ${anchored} / ${cap} · ${fmtEpoch(start)} → ${fmtEpoch(nextReset)}`;}catch(_){}}else quotaText+="\nExact Chat reset anchor: unknown";
      quotaEl.textContent=quotaText;
      const groups=rawAggregate(events,w.start,w.end);
      tbody.innerHTML=groups.length?groups.map(g=>`<tr style="border-top:1px solid #252525"><td style="padding:8px 9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(g.model)}</td><td style="padding:8px 9px;color:#aaa">${esc(g.effort||"—")}</td><td style="padding:8px 9px;text-align:right;font-variant-numeric:tabular-nums">${g.count}</td><td style="padding:8px 9px;text-align:right;font-variant-numeric:tabular-nums">${g.last24}</td><td style="padding:8px 9px;color:#999;white-space:nowrap">${g.last?esc(new Date(g.last).toLocaleString()):"—"}</td></tr>`).join(""):`<tr><td colspan="5" style="padding:14px;color:#777">No events in this range.</td></tr>`;
      refreshCacheInfo();
    }
    qa("[data-range]").forEach(btn=>btn.onclick=()=>{selectedRange=btn.dataset.range;render();});
    q('[data-act="saveSettings"]').onclick=async()=>{await ensureScopeLoaded();const tz=(tzInput.value||defaultSettings().resetTz).trim(),reset=resetInput.value.trim(),cap=Number(capInput.value||200);try{new Intl.DateTimeFormat("en-US",{timeZone:tz}).format(new Date());if(reset)zonedLocalToEpoch(reset,tz);}catch(e){alert("Invalid timezone/reset: "+(e.message||e));return;}settings.resetLocal=reset;settings.resetTz=tz;settings.gpt6Cap=Number.isFinite(cap)&&cap>0?cap:200;await saveSettings(settingsKey,settings);show("main");render();};
    q('[data-act="clearReset"]').onclick=async()=>{await ensureScopeLoaded();settings.resetLocal="";await saveSettings(settingsKey,settings);fillSettings();render();};
    q('[data-act="clearCache"]').onclick=async()=>{await ensureScopeLoaded();if(!confirm("Clear the local usage cache? The next sync will rebuild up to 30 days from ChatGPT history."))return;cache=emptyCache();events=[];await storageCall("set",{items:{[cacheKey]:cache}});show("main");render();statusEl.textContent="Local cache cleared.";};
    q('[data-act="csv"]').onclick=()=>{if(!events.length){alert("No cached events to export.");return;}const rows=[["message_id","timestamp","model_slug","reasoning_effort","dashboard_family"]];for(const e of events)rows.push([e.id,new Date(e.t).toISOString(),e.model,e.effort||"",familyKey(e.model)||"other"]);const csvEsc=v=>/[",\n]/.test(String(v??""))?`"${String(v??"").replace(/"/g,'""')}"`:String(v??"");const blob=new Blob([rows.map(r=>r.map(csvEsc).join(",")).join("\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="chatgpt-message-events.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    async function reloadLatestCache(){if(!scope)return;const loaded=await loadScopeData(scope);cache=loaded.cache;settings=loaded.settings;cacheKey=loaded.cacheKey;settingsKey=loaded.settingsKey;events=allEvents(cache);fillSettings();render();}
    async function syncNow(){
      const syncButton=q('[data-act="sync"]');
      if(SYNC_GATE.running&&SYNC_GATE.promise){syncButton.disabled=true;statusEl.textContent=events.length?`Showing ${events.length} cached turns · background sync already running…`:"Background sync already running…";progressEl.textContent="Reusing the existing sync job; no duplicate requests are being sent.";try{await SYNC_GATE.promise;await reloadLatestCache();statusEl.textContent=`Up to date · ${events.length} cached turns.`;progressEl.textContent=`Background sync finished · ${cache.lastSync?fmtEpoch(cache.lastSync):"just now"}`;}catch(e){await reloadLatestCache().catch(()=>{});statusEl.textContent=events.length?`Background sync ended with an error; showing ${events.length} cached turns.`:`Background sync failed: ${e?.message||e}`;}finally{syncButton.disabled=false;refreshCacheInfo();}return;}
      syncButton.disabled=true;SYNC_GATE.running=true;SYNC_GATE.startedAt=Date.now();
      const task=(async()=>{const started=Date.now(),errorsByStatus={},errorSamples=[];let fetched=0,unchanged=0,failed=0,newEvents=0;try{
        statusEl.textContent=events.length?`Showing ${events.length} cached turns · checking for updates…`:"No cache yet · building initial history…";progressEl.textContent="Authenticating…";
        const actualScope=await initAuth();if(actualScope!==scope){scope=actualScope;await storageCall("set",{items:{[LAST_SCOPE_KEY]:scope}});({cache,settings,cacheKey,settingsKey}=await loadScopeData(scope));events=allEvents(cache);fillSettings();render();}
        const discoveryStart=Date.now()-INITIAL_DISCOVERY_DAYS*DAY,retentionStart=Date.now()-RETENTION_DAYS*DAY,discovered=await discoverRecentConversations(discoveryStart,txt=>progressEl.textContent=txt),queue=[];
        for(const remote of discovered.items){const local=cache.conversations?.[remote.id],sameUpdate=!!local&&(!remote.u?true:(!!local.u&&Math.abs(remote.u-local.u)<1000));if(!local||!sameUpdate)queue.push(remote);else unchanged++;}
        diagEl.textContent=[`Discovered: ${discovered.items.length} unique conversations`,`Regular: ${discovered.stats.regular} · Archived: ${discovered.stats.archived} · Project: ${discovered.stats.project}`,`Projects discovered: ${discovered.stats.projects}`,`Needs fetch: ${queue.length} · Unchanged: ${unchanged}`,`Single-flight sync: ON · reopening the Meter reuses this job`,`Request pacing: one conversation at a time, ≥${REQUEST_GAP_MS}ms gap; 429/5xx use Retry-After/exponential backoff`,`Last successful sync: ${cache.lastSync?fmtEpoch(cache.lastSync):"never"}`].join("\n");
        let i=0;for(const remote of queue){i++;progressEl.textContent=`Syncing changed conversations… ${i}/${queue.length}`+(failed?` · ${failed} pending/failed`:"");try{const turns=await fetchConversationTurns(remote.id,retentionStart,Date.now()),beforeCount=Array.isArray(cache.conversations?.[remote.id]?.events)?cache.conversations[remote.id].events.length:0;cache.conversations[remote.id]={u:remote.u||cache.conversations?.[remote.id]?.u||Date.now(),source:remote.source,events:turns};newEvents+=Math.max(0,turns.length-beforeCount);fetched++;if(fetched%6===0){cache.lastSync=Date.now();cache=await saveCache(cacheKey,cache);events=allEvents(cache);render();}}catch(e){failed++;const code=String(e?.status||"other");errorsByStatus[code]=(errorsByStatus[code]||0)+1;if(errorSamples.length<6)errorSamples.push(`${remote.id.slice(0,8)}… ${e.message}`);}}
        cache.lastSync=Date.now();cache=await saveCache(cacheKey,cache);events=allEvents(cache);render();const errSummary=Object.entries(errorsByStatus).map(([k,v])=>`HTTP ${k} × ${v}`).join(" · ");diagEl.textContent+=`\nFetched successfully: ${fetched}\nFailed after retries: ${failed}${errSummary?` · ${errSummary}`:""}\nNew net cached turns: ${newEvents}`;if(errorSamples.length)diagEl.textContent+="\n\nError samples:\n"+errorSamples.join("\n");statusEl.textContent=failed?`Cache retained · ${events.length} turns · ${fetched} conversations updated · ${failed} failed after retries.`:`Up to date · ${events.length} cached turns · ${fetched} updated · ${unchanged} unchanged.`;progressEl.textContent=`Sync completed in ${((Date.now()-started)/1000).toFixed(1)}s · ${fmtEpoch(cache.lastSync)}`;return{scope,lastSync:cache.lastSync};
      }catch(e){statusEl.textContent=events.length?`Sync interrupted; showing ${events.length} cached turns.`:`Initial sync failed: ${e.message||e}`;progressEl.textContent="Cached data is never discarded because of a failed sync.";diagEl.textContent+=`\n\nFatal sync error:\n${e?.stack||e?.message||String(e)}`;throw e;}})();
      SYNC_GATE.promise=task;try{await task;}finally{SYNC_GATE.running=false;SYNC_GATE.promise=null;SYNC_GATE.lastFinishedAt=Date.now();syncButton.disabled=false;refreshCacheInfo();}
    }
    q('[data-act="sync"]').onclick=syncNow;
    try{const lastObj=await storageCall("get",{keys:[LAST_SCOPE_KEY]});scope=lastObj?.[LAST_SCOPE_KEY]||null;if(scope){({cache,settings,cacheKey,settingsKey}=await loadScopeData(scope));events=allEvents(cache);if(events.length)statusEl.textContent=`Loaded ${events.length} cached turns instantly · checking for updates…`;render();}}catch(e){statusEl.textContent="Local cache bridge unavailable; sync will retry.";}
    fillSettings();
    const cacheIsEmpty=events.length===0,cacheIsStale=!cache.lastSync||(Date.now()-cache.lastSync)>AUTO_SYNC_COOLDOWN_MS;
    if(SYNC_GATE.running)syncNow();else if(cacheIsEmpty||cacheIsStale)syncNow();else{statusEl.textContent=`Loaded ${events.length} cached turns · no refresh needed.`;progressEl.textContent=`Last sync: ${fmtEpoch(cache.lastSync)} · automatic refresh is suppressed for 15 minutes; use “Sync now” anytime.`;}
  });
})();
