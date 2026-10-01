// Update-Check beim Start: Ladebildschirm zeigen, beim Service Worker nach einer neuen Version fragen.
// Neue Version → Dateien tauschen und neu laden. Kein Netz, keine Antwort nach 10 s oder nichts Neues → lokal starten.
(function () {
  var root = document.documentElement;
  var KEY = 'restlos.updated';
  var sw = navigator.serviceWorker;

  // Direkt nach einem Update-Neustart nicht noch einmal prüfen
  try {
    if (sessionStorage.getItem(KEY)) {
      sessionStorage.removeItem(KEY);
      root.setAttribute('data-updated', '1');
      return;
    }
  } catch (e) {
    // ohne sessionStorage einfach normal weiter
  }
  // Nur wenn die App schon installiert ist (Service Worker steuert die Seite)
  if (!sw || !sw.controller) return;

  root.classList.add('checking');
  var done = false;
  var timers = [];

  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    root.classList.remove('checking');
  }

  sw.addEventListener('message', function (e) {
    if (done || !e.data || e.data.type !== 'update-result') return;
    if (e.data.changed) {
      done = true;
      try { sessionStorage.setItem(KEY, '1'); } catch (err) { /* dann eben ohne Hinweis */ }
      location.reload();
    } else {
      finish();
    }
  });

  // Ein neuer Service Worker hat übernommen (z. B. nach einer Änderung an sw.js): Er hat die
  // neuen Dateien schon geladen, also direkt neu starten
  sw.addEventListener('controllerchange', function () {
    if (done) return;
    done = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (err) { /* dann eben ohne Hinweis */ }
    location.reload();
  });

  timers.push(setTimeout(finish, 10000));
  timers.push(setTimeout(function () {
    var skip = document.getElementById('boot-skip');
    if (skip) skip.hidden = false;
  }, 3000));
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'boot-skip') finish();
  });

  // Offline: gar nicht erst warten
  if (navigator.onLine === false) { finish(); return; }
  sw.controller.postMessage({ type: 'check-update' });
})();
