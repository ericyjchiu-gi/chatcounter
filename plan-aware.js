(() => {
  "use strict";

  const VERSION = "1.5.0";
  const PAGE_CHANNEL = "CMM_PAGE_V14";
  const EXT_CHANNEL = "CMM_EXT_V14";
  const LAST_SCOPE_KEY = "cmm_v14_last_scope";
  const DAY = 86400000;
  const AUTH_REFRESH_MS = 60 * 1000;

  const PLAN_LABELS = {
    free: "Free",
    go: "Go",
    plus: "Plus",
    prolite: "Pro 5x",
    pro: "Pro 20x",
    team: "Business (legacy Team)",
    self_serve_business_prolite: "Business (self-serve)",
    self_serve_business_usage_based: "Business (usage-based)",
    business: "Business",
    ent26: "Enterprise",
    enterprise_cbp_automation: "Enterprise",
    enterprise_cbp_usage_based: "Enterprise",
    enterprise: "Enterprise",
    edu: "Edu",
    edu_plus: "Edu Plus",
    edu_pro: "Edu Pro",
    unknown: "Unknown"
  };

  let rpcSeq = 0;
  let lastAuthAt = 0;
  let authMeta = { scope:null, raw:"unknown", source:"", businessSeat:"", label:"Unknown" };
  let renderQueued = false;

  function storageCall(op, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `cmm-plan-${Date.now()}-${++rpcSeq}-${Math.random().toString(36).slice(2)}`;
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
      window.postMessage({ source:PAGE_CHANNEL, id, op, payload }, "*");
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

  function normalizePlanType(v) {
    return String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length < 2) return null;
      let body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      body += "=".repeat((4 - body.length % 4) % 4);
      const binary = atob(body);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      return null;
    }
  }

  function detectBusinessSeat(session, payloads) {
    const candidates = [
      session?.account?.business_seat_type,
      session?.account?.seat_type,
      session?.account?.seat_tier,
      session?.workspace?.seat_type,
      session?.workspace?.seat_tier,
      session?.subscription?.seat_type,
      session?.subscription?.tier,
      session?.subscription?.name
    ];
    for (const payload of payloads) {
      const auth = payload?.["https://api.openai.com/auth"] || {};
      candidates.push(auth?.business_seat_type, auth?.seat_type, auth?.seat_tier);
    }
    for (const value of candidates) {
      const s = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
      if (!s) continue;
      if (s.includes("premium")) return "premium";
      if (s.includes("standard")) return "standard";
    }
    return "";
  }

  function detectPlanMeta(session, tokens) {
    const payloads = tokens.map(decodeJwtPayload).filter(Boolean);
    const activeAccount = Array.isArray(session?.accounts)
      ? (session.accounts.find(a => a?.is_active || a?.active) || session.accounts[0])
      : null;

    const candidates = [
      ["session.account.plan_type", session?.account?.plan_type],
      ["session.plan_type", session?.plan_type],
      ["session.user.plan_type", session?.user?.plan_type],
      ["session.subscription.plan_type", session?.subscription?.plan_type],
      ["session.account.subscription.plan_type", session?.account?.subscription?.plan_type],
      ["session.accounts[].plan_type", activeAccount?.plan_type]
    ];
    payloads.forEach((payload, i) => {
      const auth = payload?.["https://api.openai.com/auth"] || {};
      candidates.push([`jwt[${i}].auth.chatgpt_plan_type`, auth?.chatgpt_plan_type]);
      candidates.push([`jwt[${i}].chatgpt_plan_type`, payload?.chatgpt_plan_type]);
    });

    let raw = "unknown", source = "";
    for (const [src, value] of candidates) {
      const normalized = normalizePlanType(value);
      if (normalized) { raw = normalized; source = src; break; }
    }

    const businessSeat = detectBusinessSeat(session, payloads);
    const businessRaw = ["team","self_serve_business_prolite","self_serve_business_usage_based","business"].includes(raw);
    const baseLabel = PLAN_LABELS[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Unknown";
    const label = businessRaw && businessSeat
      ? `Business ${businessSeat === "premium" ? "Premium" : "Standard"}`
      : baseLabel;

    const authClaim = payloads.map(p => p?.["https://api.openai.com/auth"] || {}).find(a => a?.chatgpt_account_id);
    const stableId = session?.account?.id || session?.account_id || session?.user?.account_id || authClaim?.chatgpt_account_id || session?.user?.id || session?.user?.email || "default";
    return { raw, source, businessSeat, label, stableId };
  }

  function planProfile(settings) {
    const raw = normalizePlanType(settings?.planType) || "unknown";
    const seat = settings?.businessSeat || "";
    const businessRaw = ["team","self_serve_business_prolite","self_serve_business_usage_based","business"].includes(raw);
    const label = businessRaw && seat
      ? `Business ${seat === "premium" ? "Premium" : "Standard"}`
      : (PLAN_LABELS[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Unknown");

    if (raw === "pro") return { id:"pro20x", raw, label };
    if (raw === "prolite") return { id:"pro5x", raw, label };
    if (businessRaw) {
      if (seat === "premium") return { id:"business_premium", raw, label };
      if (seat === "standard") return { id:"business_standard", raw, label };
      return { id:"business_unknown", raw, label };
    }
    if (["enterprise","ent26","enterprise_cbp_automation","enterprise_cbp_usage_based"].includes(raw)) return { id:"enterprise", raw, label };
    if (["edu","edu_plus","edu_pro"].includes(raw)) return { id:"edu", raw, label };
    return { id:raw, raw, label };
  }

  async function refreshAuth(force = false) {
    if (!force && Date.now() - lastAuthAt < AUTH_REFRESH_MS && authMeta.scope) return authMeta;
    const r = await fetch("/api/auth/session", { method:"GET", credentials:"include", cache:"no-store", headers:{accept:"application/json"} });
    if (!r.ok) throw new Error(`Session endpoint HTTP ${r.status}`);
    const session = await r.json();
    const tokens = [session?.accessToken, session?.access_token, session?.idToken, session?.id_token].filter(Boolean);
    const detected = detectPlanMeta(session, tokens);
    const scope = await hashShort(detected.stableId);
    authMeta = { scope, raw:detected.raw, source:detected.source, businessSeat:detected.businessSeat, label:detected.label };
    lastAuthAt = Date.now();

    const settingsKey = keyFor("settings", scope);
    const obj = await storageCall("get", { keys:[settingsKey] });
    const settings = { ...(obj?.[settingsKey] || {}) };
    const changed = settings.planType !== authMeta.raw || settings.planSource !== authMeta.source || settings.businessSeat !== authMeta.businessSeat;
    settings.planType = authMeta.raw;
    settings.planSource = authMeta.source;
    settings.businessSeat = authMeta.businessSeat;
    settings.planDetectedAt = Date.now();
    if (changed) await storageCall("set", { items:{[settingsKey]:settings} });
    await storageCall("set", { items:{[LAST_SCOPE_KEY]:scope} });
    return authMeta;
  }

  function familyKey(model) {
    const s = String(model || "").toLowerCase().replaceAll("_", "-");
    if (s === "gpt-6-pro" || s.startsWith("gpt-6-pro-")) return "gpt6pro";
    if (s.startsWith("gpt-5-6") && /(^|-)pro($|-)/.test(s)) return "gpt56pro";
    if (s.startsWith("gpt-5-6")) return "gpt56";
    return null;
  }

  function eventsFromCache(cache) {
    const uniq = new Map();
    for (const c of Object.values(cache?.conversations || {})) {
      for (const e of (Array.isArray(c?.events) ? c.events : [])) {
        if (e?.id && e?.t) uniq.set(e.id, e);
      }
    }
    return [...uniq.values()];
  }

  function countFamilies(events, start, end, keys) {
    const wanted = new Set(keys);
    let n = 0;
    for (const e of events) {
      if (e.t >= start && e.t <= end && wanted.has(familyKey(e.model))) n++;
    }
    return n;
  }

  function guaranteedRemaining(cap, upperBoundUsage) {
    return Math.max(0, cap - upperBoundUsage);
  }

  function getZonedParts(epoch, timeZone) {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone, year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
    });
    const p = {};
    for (const x of f.formatToParts(new Date(epoch))) if (x.type !== "literal") p[x.type] = x.value;
    return {year:+p.year, month:+p.month, day:+p.day, hour:+p.hour, minute:+p.minute, second:+p.second};
  }

  function zonedLocalToEpoch(localValue, timeZone) {
    const m = String(localValue || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
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
    if (!t) return null;
    const now = Date.now();
    while (t <= now) t += 7 * DAY;
    while (t - now > 7 * DAY) t -= 7 * DAY;
    return t;
  }

  function fmtEpoch(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString(undefined, {
      year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit", timeZoneName:"short"
    });
  }

  function quotaText(events, settings) {
    const now = Date.now();
    const profile = planProfile(settings);
    const lines = [`Detected plan: ${profile.label}${profile.raw !== "unknown" ? ` (${profile.raw})` : ""}`];

    const assumedWeekly = (keys, cap, label) => {
      if (!settings?.resetLocal) return;
      const nextReset = normalizedNextReset(settings.resetLocal, settings.resetTz || "UTC");
      if (!nextReset) return;
      const start = nextReset - 7 * DAY;
      const anchored = countFamilies(events, start, Math.min(now, nextReset), keys);
      lines.push(`${label} assumed anchored window: ${anchored} / ${cap} · ${fmtEpoch(start)} → ${fmtEpoch(nextReset)}`);
    };

    if (profile.id === "pro20x") {
      const g6week = countFamilies(events, now - 7*DAY, now, ["gpt6pro"]);
      const g56day = countFamilies(events, now - DAY, now, ["gpt56pro"]);
      const combinedDay = countFamilies(events, now - DAY, now, ["gpt56pro","gpt6pro"]);
      lines.push(`GPT-6 Pro · rolling 7d upper bound: ${g6week} · guaranteed remaining ≥ ${guaranteedRemaining(200, g6week)} / 200`);
      lines.push(`GPT-5.6 Pro · rolling 24h upper bound: ${g56day} · guaranteed remaining ≥ ${guaranteedRemaining(170, g56day)} / 170`);
      lines.push(`Combined Pro · rolling 24h upper bound: ${combinedDay} · guaranteed remaining ≥ ${guaranteedRemaining(200, combinedDay)} / 200`);
      assumedWeekly(["gpt6pro"], 200, "GPT-6 Pro");
      if (!settings?.resetLocal) lines.push("Exact Chat weekly reset anchor: unknown");
      return lines.join("\n");
    }

    if (profile.id === "pro5x") {
      const shared = countFamilies(events, now - 7*DAY, now, ["gpt56pro","gpt6pro"]);
      lines.push(`Shared Pro bucket · rolling 7d upper bound: ${shared} · guaranteed remaining ≥ ${guaranteedRemaining(50, shared)} / 50`);
      assumedWeekly(["gpt56pro","gpt6pro"], 50, "Shared Pro bucket");
      if (!settings?.resetLocal) lines.push("Exact Chat weekly reset anchor: unknown");
      return lines.join("\n");
    }

    if (profile.id === "business_premium") {
      const shared = countFamilies(events, now - 7*DAY, now, ["gpt56pro","gpt6pro"]);
      lines.push(`Shared Pro bucket · rolling 7d upper bound: ${shared} · guaranteed remaining ≥ ${guaranteedRemaining(50, shared)} / 50`);
      assumedWeekly(["gpt56pro","gpt6pro"], 50, "Shared Pro bucket");
      if (!settings?.resetLocal) lines.push("Exact Chat weekly reset anchor: unknown");
      return lines.join("\n");
    }

    if (profile.id === "business_standard") {
      const shared = countFamilies(events, now - 31*DAY, now, ["gpt56pro","gpt6pro"]);
      lines.push(`Shared Pro bucket · rolling 31d upper bound: ${shared} · guaranteed remaining ≥ ${guaranteedRemaining(15, shared)} / 15`);
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

  function ensurePlanBadge(root, settings) {
    const profile = planProfile(settings);
    let badge = root.querySelector("[data-plan-badge-v15]");
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.planBadgeV15 = "1";
      badge.style.cssText = "font-size:11px;color:#aaa;border:1px solid #333;border-radius:999px;padding:4px 8px;white-space:nowrap";
      const settingsButton = root.querySelector('[data-act="settings"]');
      settingsButton?.parentElement?.insertBefore(badge, settingsButton);
    }
    if (badge) {
      const nextText = `Plan: ${profile.label}`;
      const nextTitle = settings?.planSource ? `${settings.planType || "unknown"} via ${settings.planSource}` : (settings?.planType || "unknown");
      if (badge.textContent !== nextText) badge.textContent = nextText;
      if (badge.title !== nextTitle) badge.title = nextTitle;
    }
  }

  function decorateSettings(root, settings) {
    const settingsView = root.querySelector('[data-view="settings"]');
    if (!settingsView) return;
    let card = settingsView.querySelector("[data-plan-card-v15]");
    if (!card) {
      card = document.createElement("div");
      card.dataset.planCardV15 = "1";
      card.style.cssText = "border:1px solid #2e2e2e;border-radius:11px;padding:11px 12px;background:#111;margin-bottom:12px";
      const first = settingsView.firstElementChild;
      first?.insertAdjacentElement("afterend", card);
    }
    const profile = planProfile(settings);
    if (card) {
      const nextHtml = `<div style="font-size:11px;color:#777;margin-bottom:4px">Detected account type</div><div style="font-weight:700">${profile.label}</div><div style="font-size:11px;color:#666;margin-top:3px">Backend: ${settings?.planType || "unknown"}${settings?.planSource ? ` · source: ${settings.planSource}` : ""}</div>`;
      if (card.innerHTML !== nextHtml) card.innerHTML = nextHtml;
    }

    const cap = settingsView.querySelector("[data-cap]");
    if (cap) {
      cap.style.display = "none";
      const label = cap.previousElementSibling;
      if (label?.tagName === "LABEL") label.style.display = "none";
    }
  }

  async function renderPanel(root) {
    if (!root?.isConnected) return;
    try {
      await refreshAuth(false);
    } catch (_) {}

    let scope = authMeta.scope;
    if (!scope) {
      const last = await storageCall("get", { keys:[LAST_SCOPE_KEY] }).catch(() => ({}));
      scope = last?.[LAST_SCOPE_KEY] || null;
    }
    if (!scope) return;

    const cacheKey = keyFor("cache", scope);
    const settingsKey = keyFor("settings", scope);
    const obj = await storageCall("get", { keys:[cacheKey, settingsKey] }).catch(() => ({}));
    const cache = obj?.[cacheKey] || { conversations:{} };
    const settings = { planType:"unknown", planSource:"", businessSeat:"", ...(obj?.[settingsKey] || {}) };

    ensurePlanBadge(root, settings);
    decorateSettings(root, settings);

    /* Keep the visible extension version in sync even though v1.5 is implemented as an additive module. */
    for (const div of root.querySelectorAll("div")) {
      if (/^v1\.4\.1 · cached incremental analytics$/.test(div.textContent || "")) {
        div.textContent = `v${VERSION} · cached incremental analytics`;
        break;
      }
    }

    const quota = root.querySelector("[data-quota]");
    if (quota) {
      const nextText = quotaText(eventsFromCache(cache), settings);
      if (quota.textContent !== nextText) quota.textContent = nextText;
      const title = quota.previousElementSibling;
      if (title && title.textContent !== "Plan-aware quota safety view") title.textContent = "Plan-aware quota safety view";
    }
  }

  function findPanel() {
    return document.querySelector('[id^="cmm-root-v"]');
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(async () => {
      renderQueued = false;
      const root = findPanel();
      if (root) await renderPanel(root);
    });
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === "childList" || m.type === "characterData") {
        scheduleRender();
        break;
      }
    }
  });
  observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });

  document.addEventListener("click", event => {
    const el = event.target?.closest?.('[data-act="settings"],[data-act="back"],[data-act="sync"],[data-range]');
    if (el) setTimeout(scheduleRender, 0);
  }, true);

  refreshAuth(true).catch(() => {}).finally(scheduleRender);
  console.debug(`[CMM] plan-aware quota module v${VERSION} loaded`);
})();
