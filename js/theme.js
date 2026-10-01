// Gewählte Darstellung vor dem ersten Zeichnen setzen, damit nichts aufblitzt
(function () {
  try {
    var t = localStorage.getItem('restlos.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    // kein Speicher: Systemeinstellung gilt
  }
})();
