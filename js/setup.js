// Bootstrap: o app cria o repositório do site (com uma cópia de si mesmo), o repositório
// de dados, ativa o GitHub Pages e grava o config.json.

// Arquivos do app que são copiados para o repositório do site.
export const SELF_FILES = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/github.js',
  'js/store.js',
  'js/setup.js',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Um repositório recém-criado pode levar alguns instantes para aceitar escrita.
async function retry404(fn, delayMs) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (e.status === 404 && i < 6) { await sleep(delayMs); continue; }
      throw e;
    }
  }
}

async function ensureRepo(client, name, description) {
  try {
    await client.createRepo(name, { description });
    return true;
  } catch (e) {
    if (e.status === 422) return false; // já existe
    throw e;
  }
}

/**
 * @param client     GitHubClient autenticado
 * @param readSelf   async (path) => string  — conteúdo dos arquivos do app
 * @param onProgress (msg) => void
 */
export async function bootstrap({
  client, siteRepo, dataRepo, readSelf, onProgress = () => {}, retryDelayMs = 1500,
}) {
  const user = await client.getAuthUser();
  const owner = user.login;

  onProgress(`Criando repositório do site "${siteRepo}"...`);
  await ensureRepo(client, siteRepo, 'Site criado pelo Server Me');
  onProgress(`Criando repositório de dados "${dataRepo}"...`);
  await ensureRepo(client, dataRepo, 'Dados do site (Server Me)');

  const upsert = async (path, content) => {
    await retry404(async () => {
      const cur = await client.getFile(owner, siteRepo, path);
      await client.putFile(owner, siteRepo, path, content, {
        message: `server-me: ${path}`,
        sha: cur?.sha,
      });
    }, retryDelayMs);
  };

  for (const path of SELF_FILES) {
    onProgress(`Enviando ${path}...`);
    await upsert(path, await readSelf(path));
  }
  onProgress('Gravando config.json...');
  await upsert('config.json', JSON.stringify({ owner, dataRepo, branch: 'main' }, null, 2));

  onProgress('Ativando GitHub Pages...');
  await retry404(() => client.enablePages(owner, siteRepo), retryDelayMs);

  const siteUrl = siteRepo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner}.github.io/`
    : `https://${owner}.github.io/${siteRepo}/`;
  return { owner, siteRepo, dataRepo, siteUrl };
}
