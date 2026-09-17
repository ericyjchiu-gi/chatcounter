(() => {
  "use strict";

  const VERSION = "1.6.0";
  const ROOT_ID = "cmm-root-v160";
  const LAUNCHER_ID = "cmm-launcher-v160";
  const PAGE_CHANNEL = "CMM_PAGE_V16";
  const EXT_CHANNEL = "CMM_EXT_V16";
  const DAY = 86400000;
  const HOUR = 3600000;
  const MINUTE = 60000;
  const RETENTION_DAYS = 90;
  const INITIAL_DISCOVERY_DAYS = 32;
  const REQUEST_GAP_MS = 260;
  const SYNC_OVERLAP_MS = 2 * MINUTE;
  const PROJECT_DISCOVERY_TTL_MS = DAY;
  const BACKGROUND_RECONCILE_MIN_MS = 25 * MINUTE;

  const SERIES = [
    { key:"gpt56", label:"GPT-5.6", color:"#20b486" },
    { key:"gpt56pro", label:"GPT-5.6 Pro", color:"#4d8dff" },
    { key:"gpt6pro", label:"GPT-6 Pro", color:"#aa6cff" }
  ];

  const RANGE = {
    "24h": { label:"24 HOURS", duration:DAY, bucketMs:HOUR, buckets:24 },
    "7d": { label:"7 DAYS", duration:7*DAY, bucketMs:6*HOUR, buckets:28 },
    "30d": { label:"30 DAYS", duration:30*DAY, bucketMs:DAY, buckets:30 }
  };

  if (document.getElementById(LAUNCHER_ID)) return;

  const SYNC_GATE = window.__CMM_SYNC_GATE_V160__ || (window.__CMM_SYNC_GATE_V160__ = {
    running:false,
    promise:null,
    startedAt:0
  });

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let rpcSeq = 0;
  function bridgeCall(op, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `cmm-${Date.now()}-${++rpcSeq}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Extension bridge timed out"));
      }, 10000);
      function onMessage(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== EXT_CHANNEL || msg.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error || "Extension bridge operation failed"));
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ source:PAGE_CHANNEL, id, op, payload }, "*");
    });
  }
  const storageCall = (op, payload = {}) => bridgeCall(op, payload);
  const backgroundCall = (action, payload = {}) => bridgeCall("bg", { action, payload });

  async function hashShort(value) {
    try {
      const bytes = new TextEncoder().encode(String(value));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].slice(0,8).map(x => x.toString(16).padStart(2,"0")).join("");
    } catch (_) {
      let h = 2166136261;
      for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    }
  }

  const keyFor = (kind, scope) => `cmm_v14_${kind}_${scope}`;
  const liveKeyFor = scope => `cmm_v16_live_${scope}`;
  const LAST_SCOPE_KEY = "cmm_v14_last_scope";

  function emptyCache() {
    return { schema:2, lastSync:0, initialBuildAt:0, projectIds:[], projectDiscoveryAt:0, conversations:{} };
  }

  function sanitizeCache(v) {
    if (!v || typeof v.conversations !== "object") return emptyCache();
    if (v.schema === 1) {
      return {
        schema:2,
        lastSync:Number(v.lastSync) || 0,
        initialBuildAt:Number(v.initialBuildAt || v.lastSync) || 0,
        projectIds:Array.isArray(v.projectIds) ? v.projectIds : [],
        projectDiscoveryAt:Number(v.projectDiscoveryAt) || 0,
        conversations:v.conversations || {}
      };
    }
    if (v.schema !== 2) return emptyCache();
    return {
      schema:2,
      lastSync:Number(v.lastSync) || 0,
      initialBuildAt:Number(v.initialBuildAt) || 0,
      projectIds:Array.isArray(v.projectIds) ? v.projectIds : [],
      projectDiscoveryAt:Number(v.projectDiscoveryAt) || 0,
      conversations:v.conversations || {}
    };
  }

  function emptyLive() { return { schema:1, events:{}, lastCapture:0 }; }
  function sanitizeLive(v) {
    if (!v || v.schema !== 1 || typeof v.events !== "object") return emptyLive();
    return v;
  }

  const defaultSettings = () => ({
    resetLocal:"",
    resetTz:(() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
      catch { return "UTC"; }
    })(),
    planType:"unknown",
    planSource:"",
    businessSeat:"",
    planDetectedAt:0,
    liveCapture:true,
    autoReconcile:true,
    reconcileOnOpen:false,
    gpt6Cap:200
  });

  async function loadScopeData(scope) {
    const cacheKey = keyFor("cache", scope);
    const settingsKey = keyFor("settings", scope);
    const liveKey = liveKeyFor(scope);
    const obj = await storageCall("get", { keys:[cacheKey, settingsKey, liveKey] });
    const settings = { ...defaultSettings(), ...(obj?.[settingsKey] || {}) };
    if (!obj?.[settingsKey]) {
      const oldReset = localStorage.getItem("cmm_reset_local") || "";
      const oldTz = localStorage.getItem("cmm_reset_tz") || settings.resetTz;
      const oldCap = Number(localStorage.getItem("cmm_gpt6_cap") || 200);
      if (oldReset || oldTz || oldCap !== 200) {
        settings.resetLocal = oldReset;
        settings.resetTz = oldTz;
        settings.gpt6Cap = Number.isFinite(oldCap) && oldCap > 0 ? oldCap : 200;
        await storageCall("set", { items:{ [settingsKey]:settings } });
      }
    }
    return {
      cache:sanitizeCache(obj?.[cacheKey]),
      settings,
      live:sanitizeLive(obj?.[liveKey]),
      cacheKey,
      settingsKey,
      liveKey
    };
  }

  async function saveSettings(settingsKey, settings) {
    await storageCall("set", { items:{ [settingsKey]:settings } });
  }

  function pruneCache(cache, now = Date.now(), days = RETENTION_DAYS) {
    const cutoff = now - days*DAY;
    const next = {
      schema:2,
      lastSync:Number(cache.lastSync) || 0,
      initialBuildAt:Number(cache.initialBuildAt) || 0,
      projectIds:Array.isArray(cache.projectIds) ? cache.projectIds : [],
      projectDiscoveryAt:Number(cache.projectDiscoveryAt) || 0,
      conversations:{}
    };
    for (const [id,c] of Object.entries(cache.conversations || {})) {
      const events = Array.isArray(c.events) ? c.events.filter(e => e?.t >= cutoff) : [];
      const u = Number(c.u) || 0;
      if (events.length || u >= cutoff) next.conversations[id] = { u, source:c.source || "unknown", events };
    }
    return next;
  }

  async function saveCache(cacheKey, cache) {
    cache = pruneCache(cache);
    try {
      await storageCall("set", { items:{ [cacheKey]:cache } });
      return cache;
    } catch (e) {
      if (/quota|QUOTA_BYTES|MAX_WRITE/i.test(e.message || "")) {
        cache = pruneCache(cache, Date.now(), 45);
        await storageCall("set", { items:{ [cacheKey]:cache } });
        return cache;
      }
      throw e;
    }
  }

  function epochFromAny(v) {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v > 1e12) return v;
      if (v > 1e9) return v*1000;
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
    while (t <= now) t += 7*DAY;
    while (t-now > 7*DAY) t -= 7*DAY;
    return t;
  }

  const PLAN_LABELS = {
    free:"Free", go:"Go", plus:"Plus", prolite:"Pro 5x", pro:"Pro 20x",
    team:"Business (legacy Team)", self_serve_business_prolite:"Business (self-serve)",
    self_serve_business_usage_based:"Business (usage-based)", business:"Business",
    ent26:"Enterprise", enterprise_cbp_automation:"Enterprise", enterprise_cbp_usage_based:"Enterprise",
    enterprise:"Enterprise", edu:"Edu", edu_plus:"Edu Plus", edu_pro:"Edu Pro", unknown:"Unknown"
  };

  function normalizePlanType(v) {
    return String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length < 2) return null;
      let body = parts[1].replace(/-/g,"+").replace(/_/g,"/");
      body += "=".repeat((4-body.length%4)%4);
      const binary = atob(body);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) { return null; }
  }

  function detectBusinessSeat(session, jwtPayload) {
    const authClaims = jwtPayload?.["https://api.openai.com/auth"] || {};
    const candidates = [
      session?.account?.business_seat_type, session?.account?.seat_type, session?.account?.seat_tier,
      session?.workspace?.seat_type, session?.workspace?.seat_tier,
      session?.subscription?.seat_type, session?.subscription?.tier, session?.subscription?.name,
      authClaims?.business_seat_type, authClaims?.seat_type, authClaims?.seat_tier
    ];
    for (const value of candidates) {
      const s = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g,"-");
      if (s.includes("premium")) return "premium";
      if (s.includes("standard")) return "standard";
    }
    return "";
  }

  function detectPlanMeta(session, token) {
    const jwt = decodeJwtPayload(token) || {};
    const authClaims = jwt?.["https://api.openai.com/auth"] || {};
    const activeAccount = Array.isArray(session?.accounts)
      ? (session.accounts.find(a => a?.is_active || a?.active) || session.accounts[0])
      : null;
    const candidates = [
      ["session.account.plan_type", session?.account?.plan_type],
      ["session.plan_type", session?.plan_type],
      ["session.user.plan_type", session?.user?.plan_type],
      ["session.subscription.plan_type", session?.subscription?.plan_type],
      ["session.account.subscription.plan_type", session?.account?.subscription?.plan_type],
      ["session.accounts[].plan_type", activeAccount?.plan_type],
      ["jwt.auth.chatgpt_plan_type", authClaims?.chatgpt_plan_type],
      ["jwt.chatgpt_plan_type", jwt?.chatgpt_plan_type]
    ];
    let raw="unknown", source="";
    for (const [src,value] of candidates) {
      const normalized = normalizePlanType(value);
      if (normalized) { raw=normalized; source=src; break; }
    }
    const businessSeat = detectBusinessSeat(session, jwt);
    const baseLabel = PLAN_LABELS[raw] || raw.replace(/_/g," ").replace(/\b\w/g,c => c.toUpperCase()) || "Unknown";
    const label = businessSeat && ["team","self_serve_business_prolite","self_serve_business_usage_based","business"].includes(raw)
      ? `Business ${businessSeat === "premium" ? "Premium" : "Standard"}` : baseLabel;
    return {raw, source, businessSeat, label};
  }

  function planProfile(settings) {
    const raw = normalizePlanType(settings?.planType) || "unknown";
    const seat = settings?.businessSeat || "";
    const label = seat && ["team","self_serve_business_prolite","self_serve_business_usage_based","business"].includes(raw)
      ? `Business ${seat === "premium" ? "Premium" : "Standard"}`
      : (PLAN_LABELS[raw] || raw.replace(/_/g," ").replace(/\b\w/g,c => c.toUpperCase()) || "Unknown");
    if (raw === "pro") return {id:"pro20x", raw, label};
    if (raw === "prolite") return {id:"pro5x", raw, label};
    if (["team","self_serve_business_prolite","self_serve_business_usage_based","business"].includes(raw)) {
      if (seat === "premium") return {id:"business_premium", raw, label};
      if (seat === "standard") return {id:"business_standard", raw, label};
      return {id:"business_unknown", raw, label};
    }
    if (["enterprise","ent26","enterprise_cbp_automation","enterprise_cbp_usage_based"].includes(raw)) return {id:"enterprise", raw, label};
    if (["edu","edu_plus","edu_pro"].includes(raw)) return {id:"edu", raw, label};
    return {id:raw, raw, label};
  }

  let AUTH_TOKEN = null;
  let AUTH_SCOPE = null;
  let AUTH_PLAN_META = {raw:"unknown", source:"", businessSeat:"", label:"Unknown"};
  let AUTH_LAST_REFRESH = 0;
  let nextRequestAt = 0;

  async function initAuth() {
    const r = await fetch("/api/auth/session", {
      method:"GET", credentials:"include", cache:"no-store", headers:{"accept":"application/json"}
    });
    if (!r.ok) throw new Error(`Session endpoint HTTP ${r.status}`);
    const j = await r.json();
    AUTH_TOKEN = j?.accessToken || j?.access_token || null;
    if (!AUTH_TOKEN) throw new Error("No accessToken returned by /api/auth/session. Refresh ChatGPT and sign in again.");
    AUTH_PLAN_META = detectPlanMeta(j, AUTH_TOKEN);
    const claims = decodeJwtPayload(AUTH_TOKEN) || {};
    const auth = claims?.["https://api.openai.com/auth"] || {};
    const stableId = j?.account?.id || j?.account_id || j?.user?.account_id || auth?.chatgpt_account_id || j?.user?.id || j?.user?.email || "default";
    AUTH_SCOPE = await hashShort(stableId);
    AUTH_LAST_REFRESH = Date.now();
    return AUTH_SCOPE;
  }

  async function ensureAuth(maxAgeMs = 5*MINUTE) {
    if (AUTH_TOKEN && AUTH_SCOPE && Date.now()-AUTH_LAST_REFRESH < maxAgeMs) return AUTH_SCOPE;
    return initAuth();
  }

  async function persistDetectedPlan(scope, settings, settingsKey) {
    if (!settingsKey || !AUTH_PLAN_META) return settings;
    const next = {
      planType:AUTH_PLAN_META.raw || "unknown",
      planSource:AUTH_PLAN_META.source || "",
      businessSeat:AUTH_PLAN_META.businessSeat || "",
      planDetectedAt:Date.now()
    };
    const changed = settings.planType !== next.planType || settings.planSource !== next.planSource || settings.businessSeat !== next.businessSeat;
    Object.assign(settings, next);
    if (changed) await saveSettings(settingsKey, settings);
    await storageCall("set", {items:{[LAST_SCOPE_KEY]:scope}});
    return settings;
  }

  async function pace() {
    const now = Date.now();
    if (nextRequestAt > now) await sleep(nextRequestAt-now);
    nextRequestAt = Date.now()+REQUEST_GAP_MS;
  }

  function retryAfterMs(r, attempt) {
    const h = r.headers.get("retry-after");
    if (h) {
      const sec = Number(h);
      if (Number.isFinite(sec)) return Math.max(1000, sec*1000);
      const at = Date.parse(h);
      if (Number.isFinite(at)) return Math.max(1000, at-Date.now());
    }
    const base = [2500,5000,10000,20000,40000][Math.min(attempt,4)];
    return base + Math.floor(Math.random()*900);
  }

  async function getJSON(url, {maxRetries=4} = {}) {
    if (!AUTH_TOKEN) await initAuth();
    let reauthed = false;
    for (let attempt=0; ; attempt++) {
      await pace();
      const r = await fetch(url, {
        method:"GET", credentials:"include", cache:"no-store",
        headers:{"accept":"application/json", "authorization":`Bearer ${AUTH_TOKEN}`}
      });
      if (r.status === 401 && !reauthed) {
        reauthed = true;
        AUTH_TOKEN = null;
        await initAuth();
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && attempt < maxRetries) {
        const wait = retryAfterMs(r, attempt);
        nextRequestAt = Math.max(nextRequestAt, Date.now()+wait);
        await sleep(wait);
        continue;
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        const e = new Error(`HTTP ${r.status} — ${url}${text ? " — "+text.slice(0,160) : ""}`);
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

  function msgEpoch(m) {
    return epochFromAny(m?.create_time ?? m?.created_at ?? m?.update_time ?? m?.updated_at ?? m?.metadata?.create_time ?? m?.metadata?.timestamp);
  }

  function convEpoch(c) {
    return epochFromAny(c?.update_time ?? c?.updated_at ?? c?.create_time ?? c?.created_at) || 0;
  }

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

  function turnFromMessage(m, fallbackId="") {
    if (!isVisibleCompletedAssistant(m)) return null;
    const t = msgEpoch(m);
    if (!t) return null;
    const {model, effort} = modelIdentity(m);
    return {id:String(m.id || fallbackId || `${t}:${model}:${effort}`), t, model, effort};
  }

  function extractTurns(conv, scanStart, scanEnd) {
    const out = [];
    const push = (m, fallbackId="") => {
      const turn = turnFromMessage(m, fallbackId);
      if (turn && turn.t >= scanStart && turn.t <= scanEnd) out.push(turn);
    };
    if (Array.isArray(conv?.messages)) for (const m of conv.messages) push(m);
    if (conv?.mapping && typeof conv.mapping === "object") {
      for (const [nodeId,node] of Object.entries(conv.mapping)) push(node?.message, nodeId);
    }
    return out;
  }

  function mergeEvents(existing, incoming) {
    const uniq = new Map();
    for (const e of (Array.isArray(existing) ? existing : [])) if (e?.id && e?.t) uniq.set(e.id, e);
    for (const e of (Array.isArray(incoming) ? incoming : [])) if (e?.id && e?.t) uniq.set(e.id, e);
    return [...uniq.values()].sort((a,b) => a.t-b.t);
  }

  async function fetchConversationTurnsIncremental(id, scanStart, scanEnd, knownEvents = []) {
    const knownIds = new Set((knownEvents || []).map(e => e?.id).filter(Boolean));
    const fresh = new Map();
    let before = null;
    let usedNew = false;
    try {
      for (let page=0; page<80; page++) {
        const p = new URLSearchParams({include_has_versions:"true", num_turns:"100"});
        if (before) p.set("before", before);
        const conv = await getJSON(`/backend-api/conversations/${encodeURIComponent(id)}?${p.toString()}`, {maxRetries:4});
        usedNew = true;
        const pageTurns = extractTurns(conv, scanStart, scanEnd);
        let hitKnown = false;
        for (const t of pageTurns) {
          if (knownIds.has(t.id)) hitKnown = true;
          else fresh.set(t.id, t);
        }
        let oldest = Infinity;
        for (const m of (Array.isArray(conv?.messages) ? conv.messages : [])) {
          const t = msgEpoch(m); if (t) oldest = Math.min(oldest, t);
        }
        const pi = conv?.page_info || {};
        if (hitKnown) break;
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
      for (const t of extractTurns(conv, scanStart, scanEnd)) if (!knownIds.has(t.id)) fresh.set(t.id, t);
    }
    return [...fresh.values()];
  }

  function upsertRemote(map, id, u, source) {
    if (!id) return;
    id = String(id);
    const prev = map.get(id);
    if (!prev || (u || 0) > (prev.u || 0)) map.set(id, {id, u:u || 0, source});
  }

  async function discoverProjectIds(onProgress) {
    const ids = new Set();
    let cursor = "0";
    for (let page=0; page<20; page++) {
      onProgress(`Discovering Projects… page ${page+1}`);
      const qs = new URLSearchParams({owned_only:"true", cursor:String(cursor)});
      const j = await getJSON(`/backend-api/gizmos/snorlax/sidebar?${qs.toString()}`, {maxRetries:3});
      const walk = (v, depth=0) => {
        if (depth > 7 || v == null) return;
        if (typeof v === "string") { if (v.startsWith("g-p-")) ids.add(v); return; }
        if (Array.isArray(v)) { for (const x of v) walk(x, depth+1); return; }
        if (typeof v === "object") {
          for (const [k,x] of Object.entries(v)) {
            if ((k === "id" || k === "gizmo_id" || k === "conversation_template_id") && typeof x === "string" && x.startsWith("g-p-")) ids.add(x);
            if (depth < 3 || ["items","gizmo","gizmos","projects","project","data"].includes(k)) walk(x, depth+1);
          }
        }
      };
      walk(j);
      const next = j?.cursor ?? j?.next_cursor ?? null;
      if (!next || next === cursor) break;
      cursor = next;
    }
    return [...ids];
  }

  async function discoverRecentConversations(scanStart, onProgress, cache, fullBuild=false) {
    const map = new Map();
    const stats = {regular:0, archived:0, project:0, projects:0, pages:0, projectDiscovery:false};
    const pageSize = 100;
    async function scanRegular(label, archived) {
      for (let page=0; page<50; page++) {
        onProgress(`Listing ${label} conversations… page ${page+1}`);
        const qs = new URLSearchParams({
          offset:String(page*pageSize), limit:String(pageSize), order:"updated", is_archived:archived ? "true" : "false"
        });
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
      let projectIds = Array.isArray(cache?.projectIds) ? cache.projectIds : [];
      const projectIdsStale = !cache?.projectDiscoveryAt || Date.now()-cache.projectDiscoveryAt > PROJECT_DISCOVERY_TTL_MS;
      if (fullBuild || projectIdsStale) {
        projectIds = await discoverProjectIds(onProgress);
        cache.projectIds = projectIds;
        cache.projectDiscoveryAt = Date.now();
        stats.projectDiscovery = true;
      }
      stats.projects = projectIds.length;
      let pi = 0;
      for (const projectId of projectIds) {
        pi++;
        let cursor = "0";
        for (let page=0; page<50; page++) {
          onProgress(`Listing Project chats… ${pi}/${projectIds.length}, page ${page+1}`);
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

  function allEvents(cache, live = emptyLive()) {
    const uniq = new Map();
    for (const c of Object.values(cache?.conversations || {})) {
      for (const e of (Array.isArray(c.events) ? c.events : [])) if (e?.id && e?.t) uniq.set(e.id, e);
    }
    for (const e of Object.values(live?.events || {})) if (e?.id && e?.t) uniq.set(e.id, e);
    return [...uniq.values()].sort((a,b) => a.t-b.t);
  }

  function familyKey(model) {
    const s = String(model || "").toLowerCase().replaceAll("_","-");
    if (s === "gpt-6-pro" || s.startsWith("gpt-6-pro-")) return "gpt6pro";
    if (s.startsWith("gpt-5-6") && /(^|-)pro($|-)/.test(s)) return "gpt56pro";
    if (s.startsWith("gpt-5-6")) return "gpt56";
    return null;
  }

  function countFamily(events, start, end, key) {
    let n=0;
    for (const e of events) if (e.t >= start && e.t <= end && familyKey(e.model) === key) n++;
    return n;
  }

  function countFamilies(events, start, end, keys) {
    const wanted = new Set(keys);
    let n=0;
    for (const e of events) if (e.t >= start && e.t <= end && wanted.has(familyKey(e.model))) n++;
    return n;
  }

  const guaranteedRemaining = (cap, usage) => Math.max(0, cap-usage);

  function renderQuotaText(events, settings) {
    const now = Date.now();
    const profile = planProfile(settings);
    const lines = [`Detected plan: ${profile.label}${profile.raw && profile.raw !== "unknown" ? ` (${profile.raw})` : ""}`];
    const addAssumedWeekly = (keys, cap, label) => {
      if (!settings.resetLocal) return;
      try {
        const nextReset = normalizedNextReset(settings.resetLocal, settings.resetTz);
        const start = nextReset-7*DAY;
        const anchored = countFamilies(events, start, Math.min(now,nextReset), keys);
        lines.push(`${label} assumed anchored window: ${anchored} / ${cap} · ${fmtEpoch(start)} → ${fmtEpoch(nextReset)}`);
      } catch (_) {}
    };
    if (profile.id === "pro20x") {
      const g6week = countFamily(events, now-7*DAY, now, "gpt6pro");
      const g56day = countFamily(events, now-DAY, now, "gpt56pro");
      const combinedDay = countFamilies(events, now-DAY, now, ["gpt56pro","gpt6pro"]);
      lines.push(`GPT-6 Pro · rolling 7d upper bound: ${g6week} · guaranteed remaining ≥ ${guaranteedRemaining(200,g6week)} / 200`);
      lines.push(`GPT-5.6 Pro · rolling 24h upper bound: ${g56day} · guaranteed remaining ≥ ${guaranteedRemaining(170,g56day)} / 170`);
      lines.push(`Combined Pro · rolling 24h upper bound: ${combinedDay} · guaranteed remaining ≥ ${guaranteedRemaining(200,combinedDay)} / 200`);
      addAssumedWeekly(["gpt6pro"],200,"GPT-6 Pro");
      if (!settings.resetLocal) lines.push("Exact Chat weekly reset anchor: unknown");
      return lines.join("\n");
    }
    if (profile.id === "pro5x" || profile.id === "business_premium") {
      const sharedWeek = countFamilies(events, now-7*DAY, now, ["gpt56pro","gpt6pro"]);
      lines.push(`Shared Pro bucket · rolling 7d upper bound: ${sharedWeek} · guaranteed remaining ≥ ${guaranteedRemaining(50,sharedWeek)} / 50`);
      addAssumedWeekly(["gpt56pro","gpt6pro"],50,"Shared Pro bucket");
      if (!settings.resetLocal) lines.push("Exact Chat weekly reset anchor: unknown");
      return lines.join("\n");
    }
    if (profile.id === "business_standard") {
      const sharedMonthUpper = countFamilies(events, now-31*DAY, now, ["gpt56pro","gpt6pro"]);
      lines.push(`Shared Pro bucket · rolling 31d upper bound: ${sharedMonthUpper} · guaranteed remaining ≥ ${guaranteedRemaining(15,sharedMonthUpper)} / 15`);
      lines.push("Exact monthly reset anchor: unknown");
      return lines.join("\n");
    }
    if (profile.id === "business_unknown") {
      lines.push("Business seat tier was not exposed clearly enough to distinguish Standard from Premium, so no numeric cap is assumed.");
      return lines.join("\n");
    }
    if (["enterprise","edu"].includes(profile.id)) {
      lines.push("Workspace-managed plan: no universal public Chat message cap is hard-coded.");
      return lines.join("\n");
    }
    if (["free","go","plus"].includes(profile.id)) {
      lines.push("No fixed numeric cap is applied to these dashboard model families for this plan.");
      return lines.join("\n");
    }
    lines.push("Plan could not be mapped safely, so analytics are shown without a quota assumption.");
    return lines.join("\n");
  }

  function rangeWindow(rangeKey, now=Date.now()) {
    const c = RANGE[rangeKey] || RANGE["24h"];
    const d = new Date(now);
    let end;
    if (rangeKey === "24h") { d.setMinutes(0,0,0); d.setHours(d.getHours()+1); end=d.getTime(); }
    else if (rangeKey === "7d") { d.setMinutes(0,0,0); d.setHours(Math.floor(d.getHours()/6)*6+6); end=d.getTime(); }
    else { d.setHours(0,0,0,0); d.setDate(d.getDate()+1); end=d.getTime(); }
    return {start:end-c.buckets*c.bucketMs, end, ...c};
  }

  function bucketSeries(events, rangeKey) {
    const w = rangeWindow(rangeKey);
    const rows = Array.from({length:w.buckets}, (_,i) => ({
      start:w.start+i*w.bucketMs, end:w.start+(i+1)*w.bucketMs, gpt56:0, gpt56pro:0, gpt6pro:0
    }));
    for (const e of events) {
      if (e.t < w.start || e.t >= w.end) continue;
      const key = familyKey(e.model);
      if (!key) continue;
      const i = Math.min(w.buckets-1, Math.max(0, Math.floor((e.t-w.start)/w.bucketMs)));
      rows[i][key]++;
    }
    return {w, rows};
  }

  function rawAggregate(events, start, end) {
    const last24 = Date.now()-DAY;
    const m = new Map();
    for (const e of events) {
      const key = `${e.model}\u0000${e.effort || ""}`;
      if (!m.has(key)) m.set(key,{model:e.model, effort:e.effort || "", count:0, last24:0, last:0});
      const g = m.get(key);
      if (e.t >= start && e.t <= end) { g.count++; g.last=Math.max(g.last,e.t); }
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
    const W=800,H=245,L=42,R=12,T=18,B=34,plotW=W-L-R,plotH=H-T-B;
    const maxVal = Math.max(1,...rows.flatMap(r => SERIES.map(s => r[s.key])));
    const niceMax = Math.max(4,Math.ceil(maxVal/4)*4);
    const x = i => L+(rows.length<=1?0:i*plotW/(rows.length-1));
    const y = v => T+plotH-(v/niceMax)*plotH;
    const grid = [0,.25,.5,.75,1].map(fr => {
      const val=Math.round(niceMax*fr), yy=y(val);
      return `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#292929" stroke-width="1"/><text x="${L-8}" y="${yy+4}" fill="#777" font-size="10" text-anchor="end">${val}</text>`;
    }).join("");
    const lines = SERIES.map(s => `<polyline points="${rows.map((r,i)=>`${x(i).toFixed(1)},${y(r[s.key]).toFixed(1)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
    const tickCount = rangeKey === "24h" ? 6 : rangeKey === "7d" ? 7 : 6;
    const ticks = Array.from({length:tickCount},(_,k) => {
      const i=Math.min(rows.length-1,Math.round(k*(rows.length-1)/(tickCount-1))), xx=x(i);
      return `<text x="${xx}" y="${H-10}" fill="#777" font-size="10" text-anchor="middle">${esc(fmtShortTime(rows[i].start,rangeKey))}</text>`;
    }).join("");
    container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="245" role="img" aria-label="ChatGPT message trend">${grid}${lines}${ticks}</svg><div style="display:flex;gap:16px;flex-wrap:wrap;margin:-2px 0 2px 42px">${SERIES.map(s=>`<span style="display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:11px"><i style="display:inline-block;width:18px;height:2px;background:${s.color};border-radius:2px"></i>${s.label}</span>`).join("")}</div>`;
  }

  let activePanelRefresh = null;
  let liveCaptureInstalled = false;

  function findConversationId(value, depth=0) {
    if (depth > 7 || value == null) return "";
    if (typeof value !== "object") return "";
    if (typeof value.conversation_id === "string" && value.conversation_id) return value.conversation_id;
    if (Array.isArray(value)) {
      for (const v of value) { const id=findConversationId(v,depth+1); if (id) return id; }
      return "";
    }
    for (const v of Object.values(value)) {
      if (v && typeof v === "object") { const id=findConversationId(v,depth+1); if (id) return id; }
    }
    return "";
  }

  function collectCompletedAssistantMessages(value, out, depth=0) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      for (const v of value) collectCompletedAssistantMessages(v,out,depth+1);
      return;
    }
    if (typeof value !== "object") return;
    const turn = turnFromMessage(value);
    if (turn) out.set(turn.id, turn);
    for (const [k,v] of Object.entries(value)) {
      if (k === "content" || k === "parts" || k === "text") continue;
      if (v && typeof v === "object") collectCompletedAssistantMessages(v,out,depth+1);
    }
  }

  async function handleConversationStreamClone(response) {
    try {
      const text = await response.text();
      if (!text || text.length > 25000000) return;
      const turns = new Map();
      let conversationId = "";
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const body = line.slice(5).trim();
        if (!body || body === "[DONE]") continue;
        try {
          const obj = JSON.parse(body);
          conversationId = conversationId || findConversationId(obj);
          collectCompletedAssistantMessages(obj, turns);
        } catch (_) {}
      }
      if (!turns.size) return;
      conversationId = conversationId || location.pathname.match(/^\/c\/([A-Za-z0-9-]+)/)?.[1] || "live";
      const scope = await ensureAuth();
      const state = await loadScopeData(scope);
      await persistDetectedPlan(scope, state.settings, state.settingsKey);
      if (state.settings.liveCapture === false) return;
      await backgroundCall("append-live", { scope, conversationId, events:[...turns.values()] });
    } catch (_) {}
  }

  function installLiveCapture() {
    if (liveCaptureInstalled) return;
    liveCaptureInstalled = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function(input, init) {
      const response = await nativeFetch(input, init);
      try {
        const url = typeof input === "string" ? input : input?.url || "";
        const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
        const ct = response.headers.get("content-type") || "";
        if (method === "POST" && /\/backend-api\/conversation(?:$|[/?])/.test(url) && (ct.includes("text/event-stream") || ct.includes("json") || !ct)) {
          handleConversationStreamClone(response.clone());
        }
      } catch (_) {}
      return response;
    };
  }
  installLiveCapture();

  function emitHook(hooks, name, value) {
    try { hooks?.[name]?.(value); } catch (_) {}
  }

  async function performSync({fullBuild=false, reason="manual", hooks={}} = {}) {
    if (SYNC_GATE.running && SYNC_GATE.promise) return SYNC_GATE.promise;
    const task = (async () => {
      SYNC_GATE.running = true;
      SYNC_GATE.startedAt = Date.now();
      const started = Date.now();
      let lockToken = "";
      let renewTimer = null;
      try {
        emitHook(hooks,"status", fullBuild ? "Preparing initial history build…" : "Preparing incremental reconciliation…");
        emitHook(hooks,"progress","Authenticating…");
        const scope = await initAuth();
        let state = await loadScopeData(scope);
        let {cache,settings,live,cacheKey,settingsKey} = state;
        settings = await persistDetectedPlan(scope, settings, settingsKey);
        if (!fullBuild && !cache.initialBuildAt) {
          return {needsInitialBuild:true, scope, cache, settings, live};
        }
        const lock = await backgroundCall("acquire-sync", {scope, reason});
        if (!lock?.acquired) {
          return {busy:true, scope, ownerTabId:lock?.ownerTabId, startedAt:lock?.startedAt || 0};
        }
        lockToken = lock.token;
        renewTimer = setInterval(() => backgroundCall("renew-sync", {token:lockToken}).catch(()=>{}), 5*MINUTE);

        const now = Date.now();
        const previousLastSync = Number(cache.lastSync) || 0;
        const discoveryStart = fullBuild
          ? now-INITIAL_DISCOVERY_DAYS*DAY
          : Math.max(now-INITIAL_DISCOVERY_DAYS*DAY, (previousLastSync || cache.initialBuildAt || now)-SYNC_OVERLAP_MS);
        const messageScanStart = fullBuild ? now-INITIAL_DISCOVERY_DAYS*DAY : now-RETENTION_DAYS*DAY;

        emitHook(hooks,"status", fullBuild ? "Building initial history…" : "Checking only new or changed conversations…");
        const discovered = await discoverRecentConversations(discoveryStart, txt => emitHook(hooks,"progress",txt), cache, fullBuild);
        const queue = [];
        let unchanged = 0;
        for (const remote of discovered.items) {
          const local = cache.conversations?.[remote.id];
          const sameUpdate = !!local && (!remote.u ? true : (!!local.u && Math.abs(remote.u-local.u) < 1000));
          if (fullBuild || !local || !sameUpdate) queue.push(remote);
          else unchanged++;
        }

        emitHook(hooks,"diag", [
          `Mode: ${fullBuild ? "full history build" : "incremental reconciliation"}`,
          `Discovery cutoff: ${fmtEpoch(discoveryStart)}`,
          `Discovered: ${discovered.items.length} unique conversations`,
          `Regular: ${discovered.stats.regular} · Archived: ${discovered.stats.archived} · Project: ${discovered.stats.project}`,
          `Projects: ${discovered.stats.projects}${discovered.stats.projectDiscovery ? " · project list refreshed" : " · cached project list"}`,
          `Needs message fetch: ${queue.length} · Unchanged: ${unchanged}`,
          `Cross-tab lock: acquired`,
          `Message fetch: newest page first; stop as soon as a cached message ID is encountered`
        ].join("\n"));

        let fetched=0, failed=0, newEvents=0;
        const errorsByStatus = {}, errorSamples = [];
        let i=0;
        for (const remote of queue) {
          i++;
          emitHook(hooks,"progress",`${fullBuild ? "Building" : "Reconciling"} conversations… ${i}/${queue.length}${failed ? ` · ${failed} failed` : ""}`);
          try {
            const local = cache.conversations?.[remote.id];
            const known = fullBuild ? [] : (Array.isArray(local?.events) ? local.events : []);
            const fresh = await fetchConversationTurnsIncremental(remote.id, messageScanStart, Date.now(), known);
            const merged = mergeEvents(local?.events || [], fresh);
            newEvents += fresh.length;
            cache.conversations[remote.id] = {
              u:remote.u || local?.u || Date.now(),
              source:remote.source,
              events:merged
            };
            fetched++;
            if (fetched % 6 === 0) cache = await saveCache(cacheKey, cache);
          } catch (e) {
            failed++;
            const code = String(e?.status || "other");
            errorsByStatus[code] = (errorsByStatus[code] || 0)+1;
            if (errorSamples.length < 6) errorSamples.push(`${remote.id.slice(0,8)}… ${e.message}`);
          }
        }

        if (fullBuild) {
          if (failed === 0) {
            cache.initialBuildAt = Date.now();
            cache.lastSync = cache.initialBuildAt;
          }
        } else if (failed === 0) {
          cache.lastSync = Date.now();
        } else {
          cache.lastSync = previousLastSync;
        }

        cache = await saveCache(cacheKey, cache);
        state = await loadScopeData(scope);
        live = state.live;
        const events = allEvents(cache, live);
        const errSummary = Object.entries(errorsByStatus).map(([k,v])=>`HTTP ${k} × ${v}`).join(" · ");
        emitHook(hooks,"diagAppend", `Fetched successfully: ${fetched}\nFailed after retries: ${failed}${errSummary ? ` · ${errSummary}` : ""}\nNew message events: ${newEvents}${errorSamples.length ? `\n\nError samples:\n${errorSamples.join("\n")}` : ""}`);
        emitHook(hooks,"status", failed
          ? `${events.length} cached turns · ${fetched} conversations updated · ${failed} will retry next reconciliation.`
          : `${events.length} cached turns · ${fetched} updated · ${unchanged} unchanged.`);
        emitHook(hooks,"progress",`${fullBuild ? "Build" : "Reconciliation"} finished in ${((Date.now()-started)/1000).toFixed(1)}s.`);
        return {ok:true, scope, cache, settings, live, events, fetched, unchanged, failed, newEvents, fullBuild};
      } finally {
        if (renewTimer) clearInterval(renewTimer);
        if (lockToken) await backgroundCall("release-sync", {token:lockToken}).catch(()=>{});
        SYNC_GATE.running = false;
        SYNC_GATE.promise = null;
      }
    })();
    SYNC_GATE.promise = task;
    return task;
  }

  async function handleBackgroundReconcile() {
    try {
      const lastObj = await storageCall("get", {keys:[LAST_SCOPE_KEY]});
      const scope = lastObj?.[LAST_SCOPE_KEY];
      if (!scope) return;
      const state = await loadScopeData(scope);
      if (!state.settings.autoReconcile || !state.cache.initialBuildAt) return;
      if (state.cache.lastSync && Date.now()-state.cache.lastSync < BACKGROUND_RECONCILE_MIN_MS) return;
      await performSync({fullBuild:false, reason:"background"});
    } catch (_) {}
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== EXT_CHANNEL || msg.type !== "event") return;
    if (msg.event === "background-reconcile") handleBackgroundReconcile();
    if (["live-updated","sync-state"].includes(msg.event)) {
      try { activePanelRefresh?.(msg); } catch (_) {}
    }
  });

  const launcher = document.createElement("button");
  launcher.id = LAUNCHER_ID;
  launcher.textContent = "Meter";
  launcher.title = "Open ChatGPT Message Meter";
  launcher.style.cssText = [
    "position:fixed","right:16px","bottom:16px","z-index:2147483646","border:1px solid #383838","border-radius:999px",
    "padding:8px 12px","background:#171717","color:#f2f2f2","box-shadow:0 5px 20px rgba(0,0,0,.25)",
    "font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif","cursor:pointer"
  ].join(";");
  document.documentElement.appendChild(launcher);

  function makePanel() {
    const old = document.getElementById(ROOT_ID);
    if (old) { old.remove(); return null; }
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText = [
      "position:fixed","right:14px","top:14px","z-index:2147483647","width:min(900px,calc(100vw - 28px))","max-height:calc(100vh - 28px)","overflow:auto",
      "background:#101010","color:#f2f2f2","border:1px solid #343434","border-radius:16px","box-shadow:0 24px 80px rgba(0,0,0,.55)",
      "font:13px/1.42 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
    ].join(";");
    root.innerHTML = `
      <div style="position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:13px 16px;background:#101010;border-bottom:1px solid #2b2b2b">
        <div><div style="font-weight:760;font-size:15px">ChatGPT Message Meter</div><div style="font-size:11px;color:#767676">v${VERSION} · live events + incremental reconciliation</div></div>
        <div style="display:flex;align-items:center;gap:8px"><span data-plan-badge style="font-size:11px;color:#aaa;border:1px solid #333;border-radius:999px;padding:4px 8px">Plan: detecting…</span><button data-act="settings" class="cmm-link">Settings</button><button data-act="close" class="cmm-close">×</button></div>
      </div>
      <style>
        #${ROOT_ID} .cmm-link{all:unset;cursor:pointer;color:#aaa;padding:4px 7px}
        #${ROOT_ID} .cmm-close{all:unset;cursor:pointer;color:#aaa;font-size:22px;line-height:1;padding:0 3px}
        #${ROOT_ID} .cmm-btn{border:1px solid #3a3a3a;background:#1c1c1c;color:#ddd;border-radius:9px;padding:7px 10px;cursor:pointer;font:inherit}
        #${ROOT_ID} .cmm-btn:disabled{opacity:.45;cursor:default}
        #${ROOT_ID} .cmm-range{border:1px solid #333;background:#171717;color:#888;border-radius:8px;padding:6px 10px;cursor:pointer;font:700 11px/1.2 inherit}
        #${ROOT_ID} .cmm-range.on{background:#ececec;color:#111;border-color:#ececec}
        #${ROOT_ID} .cmm-card{border:1px solid #2e2e2e;border-radius:11px;padding:11px 12px;background:#111}
        #${ROOT_ID} input{font:inherit}
        #${ROOT_ID} .cmm-toggle{display:flex;align-items:flex-start;gap:9px;padding:8px 0;border-bottom:1px solid #242424}
        #${ROOT_ID} .cmm-toggle:last-child{border-bottom:0}
      </style>
      <div data-view="main" style="padding:15px 16px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div data-status style="color:#aaa">Loading local cache…</div><div data-cacheinfo style="font-size:11px;color:#666"></div></div>
        <div data-initial-callout class="cmm-card" style="display:none;margin-bottom:11px;border-style:dashed"><div style="font-weight:700;margin-bottom:4px">Initial history has not been built</div><div style="color:#888;font-size:12px;margin-bottom:9px">Opening the Meter does not scan your account. Live messages can still be captured locally; build history only when you want cross-device/backfill analytics.</div><button data-act="build" class="cmm-btn" style="background:#eee;color:#111">Build initial cache</button></div>
        <div style="display:flex;gap:7px;margin-bottom:12px"><button class="cmm-range" data-range="24h">24 HOURS</button><button class="cmm-range" data-range="7d">7 DAYS</button><button class="cmm-range" data-range="30d">30 DAYS</button></div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:11px">${SERIES.map(s=>`<div class="cmm-card"><div style="display:flex;align-items:center;gap:7px;font-size:11px;color:#888"><i style="width:8px;height:8px;background:${s.color};border-radius:50%"></i>${s.label}</div><div data-card="${s.key}" style="font-size:27px;font-weight:760;margin-top:4px">—</div></div>`).join("")}</div>
        <div class="cmm-card" style="margin-bottom:11px"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div style="font-weight:700">Usage trend</div><div data-range-label style="font-size:11px;color:#777"></div></div><div data-chart style="margin-top:2px"></div></div>
        <div class="cmm-card" style="margin-bottom:11px"><div style="font-weight:700;margin-bottom:5px">Plan-aware quota safety view</div><div data-quota style="color:#bbb;white-space:pre-line"></div></div>
        <div style="overflow:auto;border:1px solid #2e2e2e;border-radius:11px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:#858585;background:#171717"><th style="padding:8px 9px">Raw model slug</th><th style="padding:8px 9px">Effort</th><th style="padding:8px 9px;text-align:right">Selected range</th><th style="padding:8px 9px;text-align:right">24h</th><th style="padding:8px 9px">Last used</th></tr></thead><tbody data-tbody><tr><td colspan="5" style="padding:14px;color:#777">No cached data yet.</td></tr></tbody></table></div>
        <details style="margin-top:10px;border:1px solid #292929;border-radius:9px;padding:8px 10px"><summary style="cursor:pointer;color:#888">Sync diagnostics</summary><pre data-diag style="white-space:pre-wrap;word-break:break-word;color:#777;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;margin:8px 0 0">No reconciliation yet.</pre></details>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button data-act="sync" class="cmm-btn">Reconcile now</button><button data-act="csv" class="cmm-btn">Export CSV</button></div><div data-progress style="margin-top:9px;color:#666;font-size:11px"></div>
      </div>
      <div data-view="settings" style="display:none;padding:15px 16px 16px">
        <div style="font-weight:720;margin-bottom:12px">Account, sync behaviour & quota assumptions</div>
        <div class="cmm-card" style="margin-bottom:12px"><div style="font-size:11px;color:#777;margin-bottom:4px">Detected account type</div><div data-plan-settings style="font-weight:700">Unknown</div><div data-plan-source style="font-size:11px;color:#666;margin-top:3px"></div></div>
        <div class="cmm-card" style="margin-bottom:12px"><div style="font-weight:700;margin-bottom:4px">Sync behaviour</div>
          <label class="cmm-toggle"><input data-live-capture type="checkbox"><span><b>Capture live messages</b><br><small style="color:#777">Zero-extra-request capture for messages completed in this Chrome profile.</small></span></label>
          <label class="cmm-toggle"><input data-auto-reconcile type="checkbox"><span><b>Background reconciliation</b><br><small style="color:#777">Every ~30 minutes while a ChatGPT tab is open; checks for messages created on other devices.</small></span></label>
          <label class="cmm-toggle"><input data-reconcile-open type="checkbox"><span><b>Reconcile when Meter opens</b><br><small style="color:#777">Off by default. Opening the dashboard otherwise reads local cache only.</small></span></label>
        </div>
        <label style="display:block;color:#aaa;margin-bottom:5px">Assumed next weekly reset (optional)</label><input data-reset type="datetime-local" step="60" style="width:100%;background:#171717;color:#eee;border:1px solid #383838;border-radius:8px;padding:8px;margin-bottom:9px">
        <label style="display:block;color:#aaa;margin-bottom:5px">Timezone (IANA)</label><input data-tz type="text" placeholder="Europe/London" style="width:100%;background:#171717;color:#eee;border:1px solid #383838;border-radius:8px;padding:8px;margin-bottom:6px">
        <div style="color:#6f6f6f;font-size:11px;margin-bottom:14px">Reset anchor remains an assumption unless ChatGPT exposes its own Chat reset. Numeric caps come from the detected plan only where the mapping is sufficiently reliable.</div>
        <div class="cmm-card" style="margin-bottom:12px"><div style="font-weight:700;margin-bottom:4px">History cache</div><div data-history-state style="font-size:12px;color:#888;margin-bottom:9px"></div><button data-act="rebuild" class="cmm-btn">Rebuild last 32 days</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button data-act="saveSettings" class="cmm-btn" style="background:#eee;color:#111">Save</button><button data-act="clearReset" class="cmm-btn">Clear reset assumption</button><button data-act="clearCache" class="cmm-btn">Clear local cache</button><button data-act="back" class="cmm-btn">Back</button></div>
        <div style="margin-top:14px;padding-top:11px;border-top:1px solid #292929;color:#666;font-size:11px">The shared cache stores only message IDs, timestamps, model metadata and conversation update timestamps. Chat text and auth tokens are not persisted. Multiple ChatGPT tabs share one Chrome-level sync lock.</div>
      </div>`;
    document.documentElement.appendChild(root);
    return root;
  }

  launcher.addEventListener("click", async () => {
    const root = makePanel();
    if (!root) return;
    const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
    const statusEl=q("[data-status]"), cacheInfoEl=q("[data-cacheinfo]"), chartEl=q("[data-chart]"), quotaEl=q("[data-quota]"), tbody=q("[data-tbody]"), diagEl=q("[data-diag]"), progressEl=q("[data-progress]"), rangeLabelEl=q("[data-range-label]"), mainView=q('[data-view="main"]'), settingsView=q('[data-view="settings"]'), resetInput=q("[data-reset]"), tzInput=q("[data-tz]"), planBadgeEl=q("[data-plan-badge]"), planSettingsEl=q("[data-plan-settings]"), planSourceEl=q("[data-plan-source]"), initialCallout=q("[data-initial-callout]"), historyStateEl=q("[data-history-state]"), liveCaptureInput=q("[data-live-capture]"), autoReconcileInput=q("[data-auto-reconcile]"), reconcileOpenInput=q("[data-reconcile-open]"), syncButton=q('[data-act="sync"]');

    let scope=null, cache=emptyCache(), settings=defaultSettings(), live=emptyLive(), cacheKey=null, settingsKey=null, liveKey=null, events=[];
    let selectedRange="24h";

    const show = view => { mainView.style.display=view === "main" ? "" : "none"; settingsView.style.display=view === "settings" ? "" : "none"; };
    q('[data-act="close"]').onclick = () => { if (activePanelRefresh === refreshFromStorage) activePanelRefresh=null; root.remove(); };
    q('[data-act="settings"]').onclick = () => { fillSettings(); show("settings"); };
    q('[data-act="back"]').onclick = () => show("main");

    function fillSettings() {
      resetInput.value=settings.resetLocal || "";
      tzInput.value=settings.resetTz || defaultSettings().resetTz;
      liveCaptureInput.checked=settings.liveCapture !== false;
      autoReconcileInput.checked=settings.autoReconcile !== false;
      reconcileOpenInput.checked=settings.reconcileOnOpen === true;
      const profile=planProfile(settings);
      planSettingsEl.textContent=profile.label;
      planSourceEl.textContent=settings.planSource ? `Backend: ${settings.planType || "unknown"} · source: ${settings.planSource}` : `Backend: ${settings.planType || "unknown"}`;
      historyStateEl.textContent=cache.initialBuildAt ? `Initial history built ${fmtEpoch(cache.initialBuildAt)} · last reconciliation ${fmtEpoch(cache.lastSync)}` : "No initial history build yet. Live capture can still collect new messages from this Chrome profile.";
    }

    function render() {
      events=allEvents(cache,live);
      const w=rangeWindow(selectedRange);
      qa("[data-range]").forEach(b=>b.classList.toggle("on",b.dataset.range === selectedRange));
      rangeLabelEl.textContent=RANGE[selectedRange].label;
      for (const s of SERIES) q(`[data-card="${s.key}"]`).textContent=String(countFamily(events,w.start,w.end,s.key));
      renderLineChart(chartEl,events,selectedRange);
      const profile=planProfile(settings);
      planBadgeEl.textContent=`Plan: ${profile.label}`;
      planBadgeEl.title=settings.planSource ? `${settings.planType || "unknown"} via ${settings.planSource}` : (settings.planType || "unknown");
      quotaEl.textContent=renderQuotaText(events,settings);
      const groups=rawAggregate(events,w.start,w.end);
      tbody.innerHTML=groups.length ? groups.map(g=>`<tr style="border-top:1px solid #252525"><td style="padding:8px 9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(g.model)}</td><td style="padding:8px 9px;color:#aaa">${esc(g.effort || "—")}</td><td style="padding:8px 9px;text-align:right;font-variant-numeric:tabular-nums">${g.count}</td><td style="padding:8px 9px;text-align:right;font-variant-numeric:tabular-nums">${g.last24}</td><td style="padding:8px 9px;color:#999;white-space:nowrap">${g.last ? esc(new Date(g.last).toLocaleString()) : "—"}</td></tr>`).join("") : `<tr><td colspan="5" style="padding:14px;color:#777">No events in this range.</td></tr>`;
      initialCallout.style.display=cache.initialBuildAt ? "none" : "";
      syncButton.textContent=cache.initialBuildAt ? "Reconcile now" : "Build initial cache";
      const convs=Object.keys(cache.conversations || {}).length;
      let bytes=0; try { bytes=new Blob([JSON.stringify(cache),JSON.stringify(live),JSON.stringify(settings)]).size; } catch (_) {}
      cacheInfoEl.textContent=`Local cache ${bytesHuman(bytes)} · ${convs} conversations · ${events.length} turns`;
      fillSettings();
    }

    async function refreshFromStorage() {
      if (!scope) return;
      const state=await loadScopeData(scope);
      ({cache,settings,live,cacheKey,settingsKey,liveKey}=state);
      render();
    }
    activePanelRefresh=refreshFromStorage;

    async function ensureCurrentScope({refreshPlan=true} = {}) {
      const actualScope=await initAuth();
      scope=actualScope;
      ({cache,settings,live,cacheKey,settingsKey,liveKey}=await loadScopeData(scope));
      if (refreshPlan) settings=await persistDetectedPlan(scope,settings,settingsKey);
      render();
      return scope;
    }

    async function runPanelSync(fullBuild, reason) {
      syncButton.disabled=true;
      q('[data-act="build"]').disabled=true;
      q('[data-act="rebuild"]').disabled=true;
      try {
        const result=await performSync({fullBuild,reason,hooks:{
          status:v=>{if(root.isConnected)statusEl.textContent=v;},
          progress:v=>{if(root.isConnected)progressEl.textContent=v;},
          diag:v=>{if(root.isConnected)diagEl.textContent=v;},
          diagAppend:v=>{if(root.isConnected)diagEl.textContent+=(diagEl.textContent?"\n":"")+v;}
        }});
        if (result?.busy) {
          statusEl.textContent="Reconciliation is already running in another ChatGPT tab.";
          progressEl.textContent="No duplicate requests were sent. This panel will update when the shared cache changes.";
        } else if (result?.needsInitialBuild) {
          statusEl.textContent="Initial history has not been built. Use Build initial cache first.";
        }
        await ensureCurrentScope({refreshPlan:false}).catch(()=>refreshFromStorage());
      } finally {
        if(root.isConnected){syncButton.disabled=false;q('[data-act="build"]').disabled=false;q('[data-act="rebuild"]').disabled=false;}
      }
    }

    qa("[data-range]").forEach(btn=>btn.onclick=()=>{selectedRange=btn.dataset.range;render();});
    q('[data-act="sync"]').onclick=()=>runPanelSync(!cache.initialBuildAt,"manual");
    q('[data-act="build"]').onclick=()=>runPanelSync(true,"initial-build");
    q('[data-act="rebuild"]').onclick=()=>runPanelSync(true,"rebuild");

    q('[data-act="saveSettings"]').onclick=async()=>{
      await ensureCurrentScope({refreshPlan:true});
      const tz=(tzInput.value || defaultSettings().resetTz).trim(), reset=resetInput.value.trim();
      try { new Intl.DateTimeFormat("en-US",{timeZone:tz}).format(new Date()); if(reset)zonedLocalToEpoch(reset,tz); }
      catch(e){ alert("Invalid timezone/reset: "+(e.message || e)); return; }
      settings.resetLocal=reset;
      settings.resetTz=tz;
      settings.liveCapture=liveCaptureInput.checked;
      settings.autoReconcile=autoReconcileInput.checked;
      settings.reconcileOnOpen=reconcileOpenInput.checked;
      await saveSettings(settingsKey,settings);
      show("main");render();
    };

    q('[data-act="clearReset"]').onclick=async()=>{await ensureCurrentScope({refreshPlan:false});settings.resetLocal="";await saveSettings(settingsKey,settings);render();};
    q('[data-act="clearCache"]').onclick=async()=>{
      await ensureCurrentScope({refreshPlan:false});
      if(!confirm("Clear all local usage metadata? The next history build will reconstruct up to 32 days from ChatGPT history."))return;
      cache=emptyCache();live=emptyLive();events=[];
      await storageCall("set",{items:{[cacheKey]:cache,[liveKey]:live}});
      show("main");render();statusEl.textContent="Local cache cleared. No server scan was started.";
    };

    q('[data-act="csv"]').onclick=()=>{
      if(!events.length){alert("No cached events to export.");return;}
      const rows=[["message_id","timestamp","model_slug","reasoning_effort","dashboard_family"]];
      for(const e of events)rows.push([e.id,new Date(e.t).toISOString(),e.model,e.effort || "",familyKey(e.model) || "other"]);
      const csvEsc=v=>/[",\n]/.test(String(v??""))?`"${String(v??"").replace(/"/g,'""')}"`:String(v??"");
      const blob=new Blob([rows.map(r=>r.map(csvEsc).join(",")).join("\n")],{type:"text/csv;charset=utf-8"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="chatgpt-message-events.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };

    try {
      const lastObj=await storageCall("get",{keys:[LAST_SCOPE_KEY]});
      scope=lastObj?.[LAST_SCOPE_KEY] || null;
      if(scope){({cache,settings,live,cacheKey,settingsKey,liveKey}=await loadScopeData(scope));events=allEvents(cache,live);render();statusEl.textContent=cache.initialBuildAt?`Loaded ${events.length} cached turns. No server scan triggered.`:`Loaded local-only data. Initial history not built.`;}
    } catch(e){statusEl.textContent="Local cache bridge unavailable.";}

    ensureCurrentScope({refreshPlan:true}).then(async()=>{
      statusEl.textContent=cache.initialBuildAt?`Loaded ${events.length} cached turns. No server scan triggered.`:`No initial history scan yet. Live capture ${settings.liveCapture!==false?"is on":"is off"}.`;
      if(settings.reconcileOnOpen && cache.initialBuildAt) await runPanelSync(false,"panel-open");
    }).catch(e=>{statusEl.textContent=`Local cache shown · account refresh failed: ${e.message || e}`;});
  });
})();
