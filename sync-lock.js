/* Browser-native, origin-scoped exclusion. No extension background IPC or tab IDs. */
(() => {
  'use strict';
  if (globalThis.CMMNativeSync163) return;
  const problem = (code, message) => Object.assign(new Error(message), {code});
  const active = new Set();

  async function acquire(scope) {
    if (!scope || typeof scope !== 'string') throw problem('LOCK_SCOPE_MISSING', 'Cannot lock an unidentified account.');
    if (!globalThis.navigator?.locks?.request) {
      throw problem('LOCK_API_UNAVAILABLE', 'Browser Web Locks is unavailable in this page. No history requests were sent.');
    }
    const name = `chatcounter:history-sync:${scope}`;
    let finishAcquisition, failAcquisition, releaseHold;
    let resolved = false, held = false, abandoned = false, requestPromise;
    const controller = new AbortController();
    const hold = new Promise(resolve => { releaseHold = resolve; });
    const acquired = new Promise((resolve, reject) => { finishAcquisition = resolve; failAcquisition = reject; });
    const finish = value => { if (!resolved) { resolved = true; clearTimeout(timer); finishAcquisition(value); } };
    const fail = error => { if (!resolved) { resolved = true; clearTimeout(timer); failAcquisition(error); } };
    const timer = setTimeout(() => {
      abandoned = true;
      releaseHold();
      fail(problem('LOCK_API_TIMEOUT', 'Browser lock request did not respond. This is not a confirmed busy lock.'));
    }, 8000);
    const assertActive = () => {
      if (!held || controller.signal.aborted) throw problem('SYNC_INTERRUPTED', 'Sync was interrupted; previously saved data is retained.');
    };
    const guard = {
      acquired:true, engine:'Web Locks', signal:controller.signal,
      assertActive,
      abort() { controller.abort(); },
      async release() {
        held = false;
        active.delete(guard);
        releaseHold();
        if (requestPromise?.then) await requestPromise.catch(() => {});
      }
    };
    try {
      requestPromise = navigator.locks.request(name, {mode:'exclusive', ifAvailable:true}, lock => {
        if (abandoned) return;
        if (!lock) { finish({acquired:false, reason:'busy', engine:'Web Locks'}); return; }
        held = true;
        active.add(guard);
        finish(guard);
        return hold;
      });
      if (!requestPromise || typeof requestPromise.then !== 'function') {
        abandoned = true; held = false; active.delete(guard); releaseHold();
        fail(problem('LOCK_API_INVALID_RESPONSE', 'Browser lock API returned an invalid response; sync was not started.'));
      } else {
        requestPromise.catch(error => {
          controller.abort(); held = false; active.delete(guard);
          fail(problem('LOCK_API_ERROR', `Browser lock failed (${error?.name || 'Error'}).`));
        });
      }
    } catch (error) {
      abandoned = true; releaseHold();
      fail(problem('LOCK_API_ERROR', `Browser lock failed (${error?.name || 'Error'}).`));
    }
    return acquired;
  }
  // Abort work on navigation. Its finally block releases the lock after pending
  // writes finish; a destroyed browser context also releases its native locks.
  globalThis.addEventListener('pagehide', () => { for (const guard of active) guard.abort(); });
  globalThis.CMMNativeSync163 = Object.freeze({acquire});
})();
