// debounce(fn, delayMs) — collapses rapid calls into one invocation of the *last*
// call's args after delayMs of quiet. flush() replays that pending call immediately;
// needed by visibilitychange/pagehide handlers (main.js) which have no fresh args of
// their own — they just need "whatever was about to be saved, saved now."

export function debounce(fn, delayMs) {
  let timer = null;
  let pendingArgs = null;
  const invoke = () => {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  };
  function debounced(...args) {
    pendingArgs = args;
    clearTimeout(timer);
    timer = setTimeout(invoke, delayMs);
  }
  debounced.flush = () => { if (timer) { clearTimeout(timer); invoke(); } };
  return debounced;
}
