/* Compatibility wrapper: callback-only chrome.*, or promise-based browser.*. */
(() => {
  'use strict';
  if (globalThis.CMMExt163) return;
  const hasChrome = !!globalThis.chrome?.storage?.local;
  const api = hasChrome ? globalThis.chrome : globalThis.browser;
  const error = (code, message) => Object.assign(new Error(message), {code});
  function call(target, method, args = [], timeout = 7000) {
    return new Promise((resolve, reject) => {
      if (typeof target?.[method] !== 'function') { reject(error('EXT_API_UNAVAILABLE', `Extension API unavailable: ${method}`)); return; }
      let settled = false;
      const timer = setTimeout(() => done(error('EXT_API_TIMEOUT', `Extension API timed out: ${method}`)), timeout);
      function done(err, value) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (err) reject(err); else resolve(value);
      }
      try {
        const cb = value => {
          const last = api?.runtime?.lastError;
          done(last ? error('EXT_API_ERROR', `${method}: ${last.message || 'extension error'}`) : null, value);
        };
        const ret = hasChrome ? target[method](...args, cb) : target[method](...args);
        // Undefined is normal for callback APIs. Do not treat it as completion.
        if (ret && typeof ret.then === 'function') ret.then(v => done(null,v), e => done(error('EXT_API_ERROR', `${method}: ${e?.message || e}`)));
        else if (!hasChrome) done(error('EXT_API_INVALID_RESPONSE', `${method} did not return a Promise.`));
      } catch (e) { done(error('EXT_API_ERROR', `${method}: ${e?.message || e}`)); }
    });
  }
  globalThis.CMMExt163 = Object.freeze({api, call, error});
})();
