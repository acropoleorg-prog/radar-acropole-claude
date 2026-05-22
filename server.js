// server.js
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const cron    = require('node-cron');

const { fetchAllSources }            = require('./worker');
const { generatePost, generateBatchPosts } = require('./generator');

const app       = express();
const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'items.json');
const PASS      = process.env.DASHBOARD_PASSWORD || 'radar2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers['x-radar-token'] || req.query.token;
  if (token !== PASS) return res.status(401).json({ error: 'Não autorizado' });
  next();
}

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────
function loadItems() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function saveItems(items) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}

function mergeItems(existing, fresh) {
  const seen = new Set(existing.map(i => i.url).filter(Boolean));
  const novo = fresh.filter(i => i.url && !seen.has(i.url));
  // Mantém no máximo 500 itens, priorizando os mais recentes
  return [...novo, ...existing].slice(0, 500);
}

// ─── ROTAS PÚBLICAS ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ─── ITEMS — LEITURA ──────────────────────────────────────────────────────────
app.get('/api/items', auth, (req, res) => {
  let items = loadItems();
  const { status, category, q, sort } = req.query;

  if (status)   items = items.filter(i => i.status === status);
  if (category) items = items.filter(i => i.category === category);
  if (q)        items = items.filter(i =>
    i.title.toLowerCase().includes(q.toLowerCase()) ||
    (i.source || '').toLowerCase().includes(q.toLowerCase())
  );

  // Ordenação
  if (sort === 'oldest')   items.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  if (sort === 'newest')   items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (sort === 'approved') items.sort((a, b) => (b.status === 'approved' ? 1 : 0) - (a.status === 'approved' ? 1 : 0));

  res.json({ total: items.length, items });
});

// ─── ITEMS — BUSCA MANUAL ─────────────────────────────────────────────────────
app.post('/api/fetch', auth, async (req, res) => {
  res.json({ ok: true, message: 'Busca iniciada em background' });
  try {
    const fresh = await fetchAllSources();
    saveItems(mergeItems(loadItems(), fresh));
    console.log(`[API] Fetch: ${fresh.length} novos itens processados`);
  } catch (err) {
    console.error('[API] Erro no fetch:', err.message);
  }
});

// ─── ITEMS — ATUALIZAR STATUS / CAMPOS ────────────────────────────────────────
app.patch('/api/items/:id', auth, (req, res) => {
  const items = loadItems();
  const item  = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });

  const allowed = ['status', 'generatedPost', 'editorialNote', 'postText', 'pinnedNote', 'scheduledFor'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) item[field] = req.body[field];
  });

  item.updatedAt = new Date().toISOString();
  saveItems(items);
  res.json({ ok: true, item });
});

// ─── ITEMS — DELETE ───────────────────────────────────────────────────────────
app.delete('/api/items/:id', auth, (req, res) => {
  saveItems(loadItems().filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

// ─── GERAÇÃO — ITEM ÚNICO ─────────────────────────────────────────────────────
app.post('/api/generate/:id', auth, async (req, res) => {
  const items = loadItems();
  const item  = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });

  try {
    const result = await generatePost(item);

    item.generatedPost  = result;
    item.postText       = result.format === 'single' ? result.post : result.thread?.join('\n\n---\n\n');
    item.editorialNote  = result.editorial_note;
    item.generatedAt    = new Date().toISOString();
    item.updatedAt      = new Date().toISOString();

    saveItems(items);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[API] Erro na geração:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GERAÇÃO — BATCH (todos os pending) ───────────────────────────────────────
app.post('/api/generate-batch', auth, async (req, res) => {
  const items   = loadItems();
  const targets = items.filter(i => i.status === 'pending' && !i.generatedPost);

  if (!targets.length) return res.json({ ok: true, generated: 0, message: 'Nenhum item pendente sem post' });

  res.json({ ok: true, generating: targets.length, message: `Gerando ${targets.length} posts em background` });

  try {
    const results = await generateBatchPosts(targets);
    const itemMap = Object.fromEntries(items.map(i => [i.id, i]));

    results.forEach(r => {
      if (!r.post) return;
      const item         = itemMap[r.id];
      item.generatedPost = r.post;
      item.postText      = r.post.format === 'single' ? r.post.post : r.post.thread?.join('\n\n---\n\n');
      item.editorialNote = r.post.editorial_note;
      item.generatedAt   = new Date().toISOString();
    });

    saveItems(Object.values(itemMap));
    console.log(`[API] Batch: ${results.length} posts gerados`);
  } catch (err) {
    console.error('[API] Erro no batch:', err.message);
  }
});

// ─── PAUTAS APROVADAS — LISTA ORDENADA ────────────────────────────────────────
app.get('/api/approved', auth, (req, res) => {
  const items    = loadItems();
  const approved = items
    .filter(i => i.status === 'approved')
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ total: approved.length, items: approved });
});

// ─── PAUTAS APROVADAS — REORDENAR ─────────────────────────────────────────────
app.post('/api/approved/reorder', auth, (req, res) => {
  // Recebe { ids: ['id1', 'id2', ...] } com a nova ordem desejada
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids deve ser array' });

  const items   = loadItems();
  const order   = Object.fromEntries(ids.map((id, idx) => [id, idx]));
  const approved = items.filter(i => i.status === 'approved');

  approved.sort((a, b) => {
    const oa = order[a.id] ?? 999;
    const ob = order[b.id] ?? 999;
    return oa - ob;
  });

  // Atribui campo de ordem explícita
  approved.forEach((item, idx) => { item.boardOrder = idx; });
  saveItems(items);
  res.json({ ok: true });
});

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const items = loadItems();
  res.json({
    total:        items.length,
    pending:      items.filter(i => i.status === 'pending').length,
    approved:     items.filter(i => i.status === 'approved').length,
    rejected:     items.filter(i => i.status === 'rejected').length,
    withPost:     items.filter(i => i.generatedPost).length,
    politicaBr:   items.filter(i => i.category === 'politica-br').length,
    geopolitica:  items.filter(i => i.category === 'geopolitica').length,
  });
});

// ─── CRON — A CADA 2 HORAS ────────────────────────────────────────────────────
cron.schedule('0 */2 * * *', async () => {
  console.log('[Cron] Busca automática iniciada');
  try {
    const fresh = await fetchAllSources();
    saveItems(mergeItems(loadItems(), fresh));
    console.log(`[Cron] ${fresh.length} itens atualizados`);
  } catch (err) {
    console.error('[Cron] Erro:', err.message);
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🗺  Radar Político · porta ${PORT}\n`);
  try {
    const fresh = await fetchAllSources();
    saveItems(mergeItems([], fresh));
    console.log(`[Boot] ${fresh.length} itens carregados\n`);
  } catch (err) {
    console.error('[Boot] Erro:', err.message);
  }
});
