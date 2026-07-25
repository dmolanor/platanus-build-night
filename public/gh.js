/* GitHub, desde el navegador. El PAT NUNCA sale de tu máquina.
 *
 * `api.github.com` responde a peticiones desde el navegador (manda
 * Access-Control-Allow-Origin: *), así que la credencial puede vivir en
 * localStorage y ser el navegador quien consulte. Nuestro servidor recibe
 * únicamente los TÍTULOS de los issues, para el emparejamiento semántico.
 *
 * Por eso `pat` no entra en PINGS.query(): un token en la query string acabaría
 * en los logs de Render y de Cloudflare, que es justo lo que la auditoría marcó.
 * Los ajustes viajan en la URL; la credencial no viaja a ningún lado. */

(function () {
  var K_PAT = 'pings_gh_pat';
  var K_REPOS = 'pings_gh_repos';
  var TIMEOUT = 8000;
  var MAX_REPOS = 4;

  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

  function repos() {
    return ls(K_REPOS).split(/[,\s]+/)
      .map(function (r) { return r.trim(); })
      .filter(function (r) { return /^[\w.-]+\/[\w.-]+$/.test(r); })
      .slice(0, MAX_REPOS);
  }

  function configurado() { return Boolean(ls(K_PAT)) && repos().length > 0; }

  function guardar(pat, lista) {
    try {
      if (pat != null) localStorage.setItem(K_PAT, String(pat).trim());
      if (lista != null) localStorage.setItem(K_REPOS, String(lista).trim());
    } catch (e) {}
    return { conectado: configurado(), repos: repos() };
  }

  function olvidar() {
    try { localStorage.removeItem(K_PAT); localStorage.removeItem(K_REPOS); } catch (e) {}
  }

  async function unRepo(pat, repo) {
    var r = await fetch(
      'https://api.github.com/repos/' + repo + '/issues?state=open&per_page=60&sort=updated',
      {
        headers: {
          Authorization: 'Bearer ' + pat,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
    if (!r.ok) throw new Error(repo + ': ' + r.status);
    var json = await r.json();
    // Solo lo necesario para emparejar. El cuerpo se recorta acá, en tu máquina,
    // antes de que nada salga hacia nosotros.
    return json.map(function (i) {
      return {
        repo: repo,
        numero: i.number,
        titulo: String(i.title || '').slice(0, 140),
        esPR: Boolean(i.pull_request),
        asignado: (i.assignee && i.assignee.login) || null,
        resumen: String(i.body || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        url: i.html_url,
      };
    });
  }

  /* Qué repos alcanza este PAT. Un token fine-grained solo ve los que le
     marcaste, así que esta lista ES el alcance real del token — mejor que
     escribir "dueño/repo" de memoria y descubrir el error después. */
  async function listarRepos(pat) {
    var r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: 'Bearer ' + String(pat || '').trim(),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'el token no es válido' : 'GitHub respondió ' + r.status);
    var json = await r.json();
    return json.map(function (x) {
      return { full: x.full_name, privado: Boolean(x.private) };
    });
  }

  /** Trae los issues abiertos. Nunca lanza: devuelve {items, error}. */
  async function traer() {
    if (!configurado()) return { items: [], error: null, conectado: false };
    var pat = ls(K_PAT);
    try {
      var lotes = await Promise.all(repos().map(function (r) { return unRepo(pat, r); }));
      return { items: [].concat.apply([], lotes), error: null, conectado: true };
    } catch (e) {
      return { items: [], error: String((e && e.message) || e).slice(0, 120), conectado: true };
    }
  }

  window.PINGS_GH = { configurado: configurado, guardar: guardar, olvidar: olvidar,
                      traer: traer, repos: repos, listarRepos: listarRepos };
})();
