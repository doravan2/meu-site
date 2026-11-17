// Camada de armazenamento: documentos JSON em "colecao/id.json" no repositório de dados.
// Store        -> leitura e escrita (dono, com token). Gravações em fila + retry de conflito.
// PublicReader -> só leitura (visitantes, sem token).

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

function check(name, what) {
  if (!NAME_RE.test(name) || name === '.' || name === '..') {
    throw new Error(`${what} inválido: "${name}" (use letras, números, _ . -)`);
  }
}

function pathOf(collection, id) {
  check(collection, 'Coleção');
  check(id, 'Id');
  return `${collection}/${id}.json`;
}

const idsFromNames = (names) =>
  names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));

export class Store {
  constructor({ client, owner, repo, branch = 'main', maxRetries = 4 }) {
    Object.assign(this, { client, owner, repo, branch, maxRetries });
    this.queue = Promise.resolve();
    this.shas = new Map(); // cache de sha por caminho
  }

  _enqueue(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async get(collection, id) {
    const path = pathOf(collection, id);
    const f = await this.client.getFile(this.owner, this.repo, path, this.branch);
    if (!f) return null;
    this.shas.set(path, f.sha);
    return JSON.parse(f.content);
  }

  async list(collection) {
    check(collection, 'Coleção');
    return idsFromNames(await this.client.listDir(this.owner, this.repo, collection, this.branch));
  }

  async getAll(collection) {
    const ids = await this.list(collection);
    const docs = await Promise.all(ids.map((id) => this.get(collection, id)));
    return ids.map((id, i) => ({ id, data: docs[i] })).filter((d) => d.data !== null);
  }

  listCollections() {
    return this.client.listDirs(this.owner, this.repo, this.branch);
  }

  set(collection, id, data) {
    const path = pathOf(collection, id);
    const content = JSON.stringify(data, null, 2);
    return this._enqueue(async () => {
      for (let attempt = 0; ; attempt++) {
        let sha = this.shas.get(path);
        if (sha === undefined) {
          const f = await this.client.getFile(this.owner, this.repo, path, this.branch);
          sha = f ? f.sha : null;
        }
        try {
          const newSha = await this.client.putFile(this.owner, this.repo, path, content, {
            message: `set ${path}`,
            sha: sha || undefined,
            branch: this.branch,
          });
          this.shas.set(path, newSha);
          return;
        } catch (e) {
          // 409/422 = sha desatualizado (alguém gravou antes). Relê e tenta de novo.
          // 404 logo após criar/alterar também pode ser atraso de propagação da API.
          if ([404, 409, 422].includes(e.status) && attempt < this.maxRetries) {
            this.shas.delete(path);
            await new Promise((r) => setTimeout(r, e.status === 404 ? 800 : 0));
            continue;
          }
          throw e;
        }
      }
    });
  }

  delete(collection, id) {
    const path = pathOf(collection, id);
    return this._enqueue(async () => {
      const f = await this.client.getFile(this.owner, this.repo, path, this.branch);
      if (!f) return false;
      try {
        await this.client.deleteFile(this.owner, this.repo, path, f.sha, {
          message: `delete ${path}`,
          branch: this.branch,
        });
      } catch (e) {
        if (e.status === 404) { this.shas.delete(path); return false; } // já não existe
        throw e;
      }
      this.shas.delete(path);
      return true;
    });
  }
}

export class PublicReader {
  constructor({ client, owner, repo, branch = 'main', fetchImpl }) {
    Object.assign(this, { client, owner, repo, branch });
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async get(collection, id) {
    const path = pathOf(collection, id);
    const url = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${path}`;
    const res = await this.fetch(url);
    if (res.status === 404) {
      // raw.githubusercontent pode ter cache velho: confirma pela API antes de desistir.
      try {
        const f = await this.client.getFile(this.owner, this.repo, path, this.branch);
        return f ? JSON.parse(f.content) : null;
      } catch { return null; }
    }
    if (!res.ok) throw new Error(`Falha ao ler ${path}: ${res.status}`);
    return res.json();
  }

  async list(collection) {
    check(collection, 'Coleção');
    return idsFromNames(await this.client.listDir(this.owner, this.repo, collection, this.branch));
  }

  async getAll(collection) {
    const ids = await this.list(collection);
    const docs = await Promise.all(ids.map((id) => this.get(collection, id)));
    return ids.map((id, i) => ({ id, data: docs[i] })).filter((d) => d.data !== null);
  }

  listCollections() {
    return this.client.listDirs(this.owner, this.repo, this.branch);
  }
}
