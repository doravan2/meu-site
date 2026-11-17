import { GitHubClient } from './github.js';
import { Store, PublicReader } from './store.js';
import { bootstrap } from './setup.js';

const TOKEN_KEY = 'serverme.token';
const $view = document.getElementById('view');
const $badge = document.getElementById('badge');
const $logout = document.getElementById('btn-logout');

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else n[k] = v;
  }
  for (const c of children) n.append(c);
  return n;
}

function show(...nodes) { $view.replaceChildren(...nodes); }

async function loadConfig() {
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// ---------- Modo configuração (primeira vez, ainda sem config.json) ----------
// ---------- Tela de login com GitHub (antes de tudo) ----------
function renderLogin(onDone) {
  $badge.textContent = 'login';
  $logout.hidden = true;
  const token = el('input', { type: 'password', placeholder: 'Cole aqui o token (ghp_...)' });
  const err = el('p', { class: 'error' });
  const enter = el('button', { onclick: async () => {
    err.textContent = '';
    enter.disabled = true;
    try {
      const t = token.value.trim();
      const me = await new GitHubClient({ token: t }).getAuthUser();
      setToken(t);
      onDone(me);
    } catch (e) {
      err.textContent = `Token inválido ou sem permissão: ${e.message}`;
    } finally { enter.disabled = false; }
  } }, 'Entrar');
  show(
    el('h2', {}, 'Entrar com o GitHub'),
    el('p', { class: 'muted' }, 'Passo 1: gere um token no GitHub (a página já abre com o escopo certo). Passo 2: copie o token, cole abaixo e entre.'),
    el('a', { href: 'https://github.com/settings/tokens/new?scopes=public_repo&description=Server%20Me', target: '_blank', rel: 'noopener' }, '1. Abrir GitHub e gerar token'),
    el('label', {}, '2. Token', token),
    enter, err,
  );
}

function renderSetup(me) {
  $badge.textContent = `conectado: ${me.login}`;
  $logout.hidden = false;
  $logout.onclick = () => { setToken(null); location.reload(); };
  const token = el('input', { type: 'hidden', value: getToken() || '' });
  const site = el('input', { value: 'meu-site' });
  const data = el('input', { value: 'meu-site-dados' });
  const log = el('pre', { hidden: true });
  const err = el('p', { class: 'error' });
  const go = el('button', { onclick: async () => {
    err.textContent = '';
    log.hidden = false; log.textContent = '';
    go.disabled = true;
    try {
      const t = token.value.trim();
      const client = new GitHubClient({ token: t });
      const res = await bootstrap({
        client, siteRepo: site.value.trim(), dataRepo: data.value.trim(),
        readSelf: async (p) => (await fetch(p, { cache: 'no-store' })).text(),
        onProgress: (m) => { log.textContent += m + '\n'; },
      });
      setToken(t);
      log.textContent += `\nPronto! Seu site (pode levar ~1 min para aparecer):\n${res.siteUrl}`;
    } catch (e) {
      err.textContent = `Erro: ${e.message}`;
    } finally { go.disabled = false; }
  } }, 'Criar meu site');

  show(
    el('h2', {}, 'Criar seu site'),
    el('p', { class: 'muted' }, `Olá, ${me.login}! O app cria dois repositórios públicos na sua conta: um para o site e um para os dados. Qualquer pessoa pode ver o site; só você pode editar.`),
    el('label', {}, 'Nome do repositório do site', site),
    el('label', {}, 'Nome do repositório de dados', data),
    go, err, log,
  );
}

// ---------- Modo site (leitura para todos, edição para o dono) ----------
async function renderSite(config) {
  const reader = new PublicReader({ client: new GitHubClient(), owner: config.owner, repo: config.dataRepo, branch: config.branch });
  let store = null;

  const token = getToken();
  if (token) {
    try {
      const client = new GitHubClient({ token });
      const me = await client.getAuthUser();
      if (me.login.toLowerCase() === config.owner.toLowerCase()) {
        store = new Store({ client, owner: config.owner, repo: config.dataRepo, branch: config.branch });
      }
    } catch { /* token inválido: segue em modo leitura */ }
  }

  $badge.textContent = store ? 'modo edição' : 'somente leitura';
  $badge.className = 'badge' + (store ? ' edit' : '');
  $logout.hidden = !store;
  $logout.onclick = () => { setToken(null); location.reload(); };

  const list = el('div');
  const status = el('p', { class: 'error' });

  async function refresh() {
    list.replaceChildren(el('p', { class: 'muted' }, 'Carregando...'));
    try {
      const notes = await (store || reader).getAll('notas');
      notes.sort((a, b) => (b.data.updated || '').localeCompare(a.data.updated || ''));
      list.replaceChildren(...(notes.length ? notes.map(card) : [el('p', { class: 'muted' }, 'Nenhuma nota ainda.')]));
    } catch (e) { list.replaceChildren(el('p', { class: 'error' }, `Erro ao ler: ${e.message}`)); }
  }

  function card({ id, data }) {
    const kids = [el('h3', {}, data.title || '(sem título)'), el('p', {}, data.text || '')];
    if (store) {
      kids.push(
        el('button', { class: 'ghost', onclick: () => { title.value = data.title; text.value = data.text; form.dataset.id = id; title.focus(); } }, 'Editar'),
        ' ',
        el('button', { class: 'danger', onclick: async () => { await run(() => store.delete('notas', id)); } }, 'Apagar'),
      );
    }
    return el('div', { class: 'card' }, ...kids);
  }

  async function run(fn) {
    status.textContent = '';
    try { await fn(); await refresh(); } catch (e) { status.textContent = `Erro: ${e.message}`; }
  }

  const title = el('input', { placeholder: 'Título' });
  const text = el('textarea', { rows: 3, placeholder: 'Texto' });
  const form = el('div', { class: 'card' },
    el('strong', {}, 'Nova nota'), title, text,
    el('button', { onclick: () => run(async () => {
      const id = form.dataset.id || `n${Date.now()}`;
      await store.set('notas', id, { title: title.value, text: text.value, updated: new Date().toISOString() });
      title.value = text.value = ''; delete form.dataset.id;
    }) }, 'Salvar'),
  );

  const login = !store && el('p', { class: 'muted' }, 'Você é o dono? ',
    el('a', { href: '#', onclick: (e) => {
      e.preventDefault();
      const t = prompt('Cole seu token do GitHub:');
      if (t) { setToken(t.trim()); location.reload(); }
    } }, 'Entrar para editar'));

  const notesView = el('div', {}, ...(store ? [form] : []), status, list);
  const storageView = el('div', { hidden: true });
  let storageLoaded = false;
  const tabSite = el('button', { class: 'tab active', onclick: () => pick(false) }, 'Site');
  const tabStore = el('button', { class: 'tab', onclick: () => pick(true) }, 'Armazenamento');
  function pick(isStorage) {
    notesView.hidden = isStorage; storageView.hidden = !isStorage;
    tabSite.classList.toggle('active', !isStorage); tabStore.classList.toggle('active', isStorage);
    if (isStorage && !storageLoaded) { storageLoaded = true; storageView.replaceChildren(renderStorage(store || reader, !!store)); }
  }

  show(el('h2', {}, `Site de ${config.owner}`), el('div', { class: 'tabs' }, tabSite, ' ', tabStore),
    notesView, storageView, ...(login ? [login] : []), ...(store ? [securityPanel(config)] : []));
  await refresh();
}

// ---------- Segurança: trocar o token amplo por um fine-grained limitado ao repositório de dados ----------
function securityPanel(config) {
  const url = 'https://github.com/settings/personal-access-tokens/new';
  const input = el('input', { type: 'password', placeholder: 'Cole o token fine-grained (github_pat_...)' });
  const msg = el('p', { class: 'error' });
  const btn = el('button', { onclick: async () => {
    msg.textContent = ''; msg.className = 'error';
    btn.disabled = true;
    try {
      const t = input.value.trim();
      const client = new GitHubClient({ token: t });
      const me = await client.getAuthUser();
      if (me.login.toLowerCase() !== config.owner.toLowerCase()) throw new Error('esse token é de outra conta');
      const repo = await client.getRepo(config.owner, config.dataRepo);
      if (!repo.permissions?.push) throw new Error(`o token não tem permissão de escrita em ${config.dataRepo} (Contents: Read and write)`);
      setToken(t);
      msg.className = 'muted';
      msg.textContent = 'Token trocado! Recarregando...';
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      msg.textContent = `Token não aceito: ${e.message}`;
    } finally { btn.disabled = false; }
  } }, 'Trocar token');
  return el('details', { class: 'card' },
    el('summary', {}, 'Segurança: usar token restrito (recomendado)'),
    el('p', { class: 'muted' }, `O token atual (public_repo) acessa todos os seus repositórios públicos. Crie um token fine-grained: Repository access → Only select repositories → ${config.dataRepo}; Permissions → Contents: Read and write. Depois cole abaixo. Depois da troca, apague o token antigo em GitHub → Settings → Tokens.`),
    el('a', { href: url, target: '_blank', rel: 'noopener' }, 'Abrir página de criação de token'),
    el('label', {}, 'Novo token', input), btn, msg);
}

// ---------- Armazenamento: coleções e documentos JSON (edição só para o dono) ----------
function renderStorage(db, canEdit) {
  const root = el('div');
  const msg = el('p', { class: 'error' });
  const cols = el('div');
  const docs = el('div');
  const editor = el('div');
  let current = null;

  const fail = (e) => { msg.textContent = `Erro: ${e.message}`; };

  async function loadCollections() {
    cols.replaceChildren(el('p', { class: 'muted' }, 'Carregando coleções...'));
    try {
      const names = await db.listCollections();
      cols.replaceChildren(...(names.length ? names : []).map((n) =>
        el('button', { class: 'ghost' + (n === current ? ' active' : ''), onclick: () => openCollection(n) }, n)),
        ...(names.length ? [] : [el('p', { class: 'muted' }, 'Nenhuma coleção ainda.')]));
    } catch (e) { fail(e); }
  }

  async function openCollection(name) {
    current = name; msg.textContent = ''; editor.replaceChildren();
    docs.replaceChildren(el('p', { class: 'muted' }, 'Carregando...'));
    try {
      const ids = await db.list(name);
      const nodes = ids.map((id) => el('button', { class: 'ghost', onclick: () => openDoc(id) }, id));
      docs.replaceChildren(el('h3', {}, `Coleção: ${name}`),
        ...(nodes.length ? nodes : [el('p', { class: 'muted' }, 'Vazia.')]),
        ...(canEdit ? [newDocForm()] : []));
    } catch (e) { fail(e); }
  }

  function newDocForm() {
    const id = el('input', { placeholder: 'id do novo documento' });
    return el('p', {}, id, el('button', { onclick: () => {
      try { id.value.trim() && openDoc(id.value.trim(), true); } catch (e) { fail(e); }
    } }, 'Novo documento'));
  }

  async function openDoc(id, isNew = false) {
    msg.textContent = '';
    try {
      const data = isNew ? {} : await db.get(current, id);
      const area = el('textarea', { rows: 12, value: JSON.stringify(data, null, 2), readOnly: !canEdit });
      const kids = [el('h3', {}, `${current}/${id}.json`), area];
      if (canEdit) {
        const col = current;
        kids.push(
          el('button', { onclick: async () => {
            msg.textContent = '';
            let parsed;
            try { parsed = JSON.parse(area.value); } catch (e) { return fail(new Error(`JSON inválido: ${e.message}`)); }
            try { await db.set(col, id, parsed); await loadCollections(); await openCollection(col); } catch (e) { fail(e); }
          } }, 'Salvar'), ' ',
          el('button', { class: 'danger', onclick: async () => {
            if (!confirm(`Apagar ${col}/${id}?`)) return;
            try { await db.delete(col, id); await loadCollections(); await openCollection(col); } catch (e) { fail(e); }
          } }, 'Apagar'),
        );
      }
      editor.replaceChildren(...kids);
    } catch (e) { fail(e); }
  }

  const newCol = el('input', { placeholder: 'nome da nova coleção' });
  const createCol = canEdit && el('p', {}, newCol, el('button', { onclick: () => {
    try { const n = newCol.value.trim(); if (n) { newCol.value = ''; docs.replaceChildren(); openCollection(n); } } catch (e) { fail(e); }
  } }, 'Criar coleção'));

  root.append(
    el('p', { class: 'muted' }, canEdit
      ? 'Cada coleção é uma pasta no repositório de dados; cada documento é um arquivo JSON. Uma coleção nova só aparece na lista depois do primeiro documento salvo. Os dados são públicos.'
      : 'Dados públicos deste site (somente leitura).'),
    msg, cols, ...(createCol ? [createCol] : []), docs, editor);
  loadCollections();
  return root;
}

(async () => {
  const config = await loadConfig();
  if (config) return renderSite(config);
  const t = getToken();
  if (t) {
    try { return renderSetup(await new GitHubClient({ token: t }).getAuthUser()); } catch { setToken(null); }
  }
  renderLogin(renderSetup);
})();
