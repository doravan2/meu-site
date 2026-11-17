// Cliente mínimo da API do GitHub. Sem dependências: roda no navegador e no Node 18+.

export class GitHubError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubClient {
  constructor({ token = null, fetchImpl, base = 'https://api.github.com' } = {}) {
    this.token = token;
    this.base = base;
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async request(method, path, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await this.fetch(this.base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const where = path.replace(/\?.*$/, '');
      throw new GitHubError(res.status, `${data?.message || res.statusText} (${method} ${where})`, data);
    }
    return data;
  }

  getAuthUser() {
    return this.request('GET', '/user');
  }

  getRepo(owner, repo) {
    return this.request('GET', `/repos/${owner}/${repo}`);
  }

  createRepo(name, { description = '', isPrivate = false } = {}) {
    return this.request('POST', '/user/repos', {
      name,
      description,
      private: isPrivate,
      auto_init: true,
    });
  }

  async enablePages(owner, repo, branch = 'main') {
    try {
      return await this.request('POST', `/repos/${owner}/${repo}/pages`, {
        source: { branch, path: '/' },
      });
    } catch (e) {
      if (e.status === 409) return null; // Pages já ativado
      throw e;
    }
  }

  /** Retorna { content, sha } ou null se o arquivo não existe. */
  async getFile(owner, repo, path, branch) {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    try {
      const d = await this.request('GET', `/repos/${owner}/${repo}/contents/${path}${q}`);
      return { content: fromBase64(d.content), sha: d.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** Cria ou atualiza. Para atualizar é preciso passar o sha atual. Retorna o novo sha. */
  async putFile(owner, repo, path, content, { message, sha, branch } = {}) {
    const body = { message: message || `update ${path}`, content: toBase64(content) };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;
    const d = await this.request('PUT', `/repos/${owner}/${repo}/contents/${path}`, body);
    return d.content.sha;
  }

  deleteFile(owner, repo, path, sha, { message, branch } = {}) {
    const body = { message: message || `delete ${path}`, sha };
    if (branch) body.branch = branch;
    return this.request('DELETE', `/repos/${owner}/${repo}/contents/${path}`, body);
  }

  /** Lista as pastas da raiz do repositório (as "coleções"). */
  async listDirs(owner, repo, branch) {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    try {
      const d = await this.request('GET', `/repos/${owner}/${repo}/contents${q}`);
      return Array.isArray(d) ? d.filter((f) => f.type === 'dir' && !f.name.startsWith('.')).map((f) => f.name) : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  /** Lista nomes de arquivos de uma pasta ([] se não existir). */
  async listDir(owner, repo, path, branch) {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    try {
      const d = await this.request('GET', `/repos/${owner}/${repo}/contents/${path}${q}`);
      return Array.isArray(d) ? d.filter((f) => f.type === 'file').map((f) => f.name) : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }
}
