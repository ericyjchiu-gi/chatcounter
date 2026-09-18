/* Small release-label shim: v1.7.2 keeps the v1.7.1 dashboard module unchanged. */
(() => {
  'use strict';
  const patch = () => {
    const subtitle = document.getElementById('chatcounter-v17')?.shadowRoot?.querySelector('header small');
    if (subtitle) subtitle.textContent = 'v1.7.2 · Universal · stage-aware Projects';
  };
  new MutationObserver(patch).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',()=>setTimeout(patch,0),true);
  patch();
})();
