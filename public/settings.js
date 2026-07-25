/* Pings — configuración. Sin cuentas, sin sesiones, sin base de datos.
   La verdad vive en localStorage y VIAJA en la query string de la URL del widget.
   Como el QR se genera desde esa misma URL, el celular hereda los ajustes sin login.
   Ese es todo el truco: es lo que hace que la personalización no cueste backend.

   Este archivo lo cargan la landing y el widget. En widget.html va en el <head> SIN
   defer, porque tiene que sembrar pings_mute antes de que corra el script inline del
   body que lo lee (widget.html:96). Consecuencia: cuando esto ejecuta, document.body
   todavía es null. Por eso los atributos van en <html>. */

(function () {
  var DEFAULTS = { who: '', rate: 60, money: 1, sens: 'normal', face: 1, voice: 1, tono: 'seco' };
  var K = { who: 'pings_who', rate: 'pings_rate', money: 'pings_money',
            sens: 'pings_sens', face: 'pings_face', voice: 'pings_mute',
            tono: 'pings_tono' };

  var TONOS = { seco: 1, suelto: 1, charro: 1 };

  var SENS = {                       // minutos de nudge / angry / toll
    relax:  [5, 10, 20],
    normal: [2, 5, 10],              // el de CONTRACT.md §1
    strict: [1, 3, 5],
  };

  var params = new URLSearchParams(location.search);

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLs(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // Precedencia: param de URL > localStorage > default. El param gana porque es el
  // mecanismo de transporte: si llegaste por el QR, la URL es la que manda.
  function read() {
    var s = {};
    s.who = params.get('who') || ls(K.who) || DEFAULTS.who;
    s.rate = num(params.get('rate'), num(ls(K.rate), DEFAULTS.rate));
    s.money = bool(params.get('money'), bool(ls(K.money), DEFAULTS.money));
    s.sens = SENS[params.get('sens')] ? params.get('sens')
           : SENS[ls(K.sens)] ? ls(K.sens) : DEFAULTS.sens;
    // El default es `seco`: una voz graciosa por defecto clasifica el producto
    // como juguete en veinte segundos. Los otros dos son opt-in explícito.
    s.tono = TONOS[params.get('tono')] ? params.get('tono')
           : TONOS[ls(K.tono)] ? ls(K.tono) : DEFAULTS.tono;
    s.face = bool(params.get('face'), bool(ls(K.face), DEFAULTS.face));
    // pings_mute guarda lo contrario de voice: '1' = muteado.
    s.voice = params.has('voice') ? bool(params.get('voice'), 1)
            : (ls(K.voice) === '1' ? 0 : 1);
    return s;
  }

  function num(v, fb) {
    var n = Number(v);
    return v !== null && v !== '' && isFinite(n) && n > 0 ? Math.min(n, 100000) : fb;
  }
  function bool(v, fb) {
    if (v === null || v === '') return fb;
    return v === '0' || v === 'false' ? 0 : 1;
  }

  function save(patch) {
    for (var k in patch) {
      if (k === 'voice') setLs(K.voice, patch.voice ? '0' : '1');
      else if (K[k]) setLs(K[k], String(patch[k]));
    }
  }

  // La URL lleva los ajustes EXPLÍCITOS, no solo los que difieren del default.
  // Emitir solo las diferencias parecía más limpio (un QR más corto es un QR menos
  // denso) pero abre un desajuste: sin el param, el widget cae al localStorage, y la
  // landing y el widget comparten origen. Si la URL decía una cosa y el localStorage
  // otra, ganaba el localStorage y el ajuste se ignoraba en silencio.
  //
  // `voice` es la excepción y va solo cuando está apagada: es el único ajuste que el
  // widget puede cambiar por su cuenta (tiene botón de mute). Fijarlo en la URL haría
  // que cada recarga le pisara al usuario lo que acaba de apretar.
  function query(token) {
    var s = read();
    var out = [];
    if (token) out.push('token=' + encodeURIComponent(token));
    out.push('rate=' + s.rate);
    out.push('money=' + (s.money ? '1' : '0'));
    out.push('sens=' + s.sens);
    out.push('tono=' + s.tono);
    out.push('face=' + (s.face ? '1' : '0'));
    if (!s.voice) out.push('voice=0');
    return out.join('&');
  }

  var S = read();

  // ── Lo que se aplica en el <html>, antes de que exista el body ──────────────
  var html = document.documentElement;
  html.setAttribute('data-face', S.face ? '1' : '0');
  html.setAttribute('data-money', S.money ? '1' : '0');

  // `preview=1`: el widget del hero de la landing. Es una MUESTRA, y como vive en un
  // iframe del mismo origen comparte este localStorage — sin esta marca, su `voice=0`
  // le apagaría la voz al widget de verdad con solo abrir la página.
  var esPreview = params.has('preview');

  // Sembrar el mute SOLO si el param vino explícito. Si no, respetamos lo que el
  // usuario haya apretado dentro del widget: sobreescribirlo en cada recarga sería
  // pelearle al botón que ya existe.
  if (params.has('voice') && !esPreview) setLs(K.voice, S.voice ? '0' : '1');

  window.PINGS = { read: read, save: save, query: query, DEFAULTS: DEFAULTS,
                   SENS: SENS, preview: esPreview };

  // ── Acumulado del día, solo en el widget ───────────────────────────────────
  // Va por fetch a /api/state cada 10 s en vez de por el SSE. Desacoplado a
  // propósito: no toca render() ni el stream, así que sobrevive a que widget.html
  // se reescriba. 10 s de granularidad sobran para un total de la jornada.
  var token = params.get('token');
  if (!token) return;

  document.addEventListener('DOMContentLoaded', function () {
    var wrap = document.getElementById('debt-wrap');
    if (!wrap) return;                       // no estamos en el widget

    // Nodo armado una sola vez con createElement, y después solo se le cambia el
    // textContent. CONTRACT.md §7 prohíbe innerHTML en el widget: acá los valores son
    // números que formateamos nosotros, pero dejar el patrón invita a copiarlo donde
    // sí haya datos de un hook.
    var node = document.createElement('div');
    node.className = 'hoy';
    node.hidden = true;
    var bMin = document.createElement('b');
    var bUsd = document.createElement('b');
    var sepUsd = document.createTextNode(' · ');
    node.appendChild(document.createTextNode('hoy · '));
    node.appendChild(bMin);
    node.appendChild(document.createTextNode(' agent-min'));
    wrap.appendChild(node);

    function pintar(cost) {
      if (!cost || !cost.perdidoHoyMs || cost.perdidoHoyMs < 30000) {
        node.hidden = true;
        return;
      }
      bMin.textContent = String(Math.round(cost.perdidoHoyMs / 60000));
      var conPlata = S.money && cost.perdidoHoyUsd >= 0.01;
      if (conPlata) {
        bUsd.textContent = '≈$' + cost.perdidoHoyUsd.toFixed(2);
        if (!bUsd.parentNode) { node.appendChild(sepUsd); node.appendChild(bUsd); }
      } else if (bUsd.parentNode) {
        node.removeChild(sepUsd);
        node.removeChild(bUsd);
      }
      node.hidden = false;
    }

    function tick() {
      // location.search entero, no solo el token: el servidor necesita &rate= y &money=
      // para devolver el acumulado en la moneda que el usuario configuró.
      fetch('/api/state' + location.search)
        .then(function (r) { return r.json(); })
        .then(function (snap) { pintar(snap.cost); })
        .catch(function () {});          // sin red no pasa nada: la línea se queda quieta
    }

    tick();
    setInterval(tick, 10000);
  });
})();
