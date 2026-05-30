(function () {
  let lastSent = 0;
  const THROTTLE_MS = 30_000;

  function report() {
    const now = Date.now();
    if (now - lastSent < THROTTLE_MS) return;
    lastSent = now;

    chrome.runtime
      .sendMessage({ type: 'ACTIVITY', url: location.href, timestamp: now })
      .catch(() => {});
  }

  const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
  for (const evt of events) {
    document.addEventListener(evt, report, { passive: true, capture: false });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') report();
  });

  report();
})();
