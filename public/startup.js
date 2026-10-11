(function () {
  var retryKey = 'blocklens_load_retry';
  var retryWindow = 60000;
  var retrying = false;
  var root = document.getElementById('root');
  var shell = root && root.querySelector('[data-startup-shell]');
  var timer;
  function showFailure() {
    if (!root || !shell) return;
    // A restored tab may have lost its rendered content. Never replace a
    // healthy application or alter its session/trading data.
    if (!root.firstElementChild) root.appendChild(shell);
    if (!root.contains(shell)) return;
    shell.setAttribute('role', 'alert');
    shell.querySelector('[data-startup-title]').textContent = 'We couldn’t load BlockLens.';
    shell.querySelector('[data-startup-message]').textContent = 'Check your connection and try again.';
    shell.querySelector('[data-startup-retry]').hidden = false;
  }
  function recover() {
    if (retrying) return false;
    // Persist the guard across navigation. If storage is blocked, show the
    // retry screen rather than risk an automatic reload loop.
    try {
      var last = Number(sessionStorage.getItem(retryKey));
      if (last && Date.now() - last < retryWindow) { showFailure(); return false; }
      sessionStorage.setItem(retryKey, String(Date.now()));
    } catch (_) { showFailure(); return false; }
    retrying = true;
    window.location.reload();
    return true;
  }
  function scheduleFallback() {
    clearTimeout(timer);
    if (root && (root.contains(shell) || !root.firstElementChild)) timer = setTimeout(showFailure, 20000);
  }
  if (shell) shell.querySelector('[data-startup-retry]').addEventListener('click', function () { window.location.reload(); });
  window.addEventListener('vite:preloadError', function (event) {
    if (recover()) event.preventDefault();
  });
  window.addEventListener('error', function (event) {
    var script = event.target;
    if (script && script.tagName === 'SCRIPT' && /\/(?:assets\/.*\.js|src\/index\.tsx)(?:\?|$)/.test(script.src)) recover();
    else if ((event.error || event.message) && root && root.contains(shell)) showFailure();
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var message = String(event.reason && event.reason.message || event.reason || '');
    if (/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|Unable to preload CSS/i.test(message)) recover();
  });
  window.addEventListener('pageshow', function () {
    if (root && !root.firstElementChild) showFailure();
    scheduleFallback();
  });
  scheduleFallback();
}());
