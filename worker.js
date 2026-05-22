// worker.js
const Parser = require('rss-parser');
const axios  = require('axios');
const { v4: uuidv4 } = require('uuid');

const parser = new Parser();

// ─── FONTES RSS ────────────────────────────────────────────────────────────────
// dedicated: true  = feed exclusivo de política/geopolítica — sem filtro
// dedicated: false = feed geral — passa pelo filtro de palavras-chave
const RSS_SOURCES = [

  // ══ POLÍTICA BRASILEIRA — Grandes portais ══════════════════════════════════
  { name: 'G1 Política',          url: 'https://g1.globo.com/rss/g1/politica/feed.xml',                      dedicated: true  },
  { name: 'Folha Poder',          url: 'https://feeds.folha.uol.com.br/poder/rss091.xml',                    dedicated: true  },
  { name: 'Estadão Política',     url: 'https://www.estadao.com.br/politica/feed',                           dedicated: true  },
  { name: 'O Globo Política',     url: 'https://oglobo.globo.com/politica/rss.xml',                          dedicated: true  },
  { name: 'UOL Política',         url: 'https://rss.uol.com.br/feed/politica.xml',                           dedicated: true  },
  { name: 'Veja Brasil',          url: 'https://veja.abril.com.br/feed/',                                    dedicated: false },
  { name: 'IstoÉ',                url: 'https://istoe.com.br/feed/',                                         dedicated: false },
  { name: 'Terra Política',       url: 'https://www.terra.com.br/noticias/brasil/politica/rss',              dedicated: true  },

  // ══ ESPECIALIZADOS EM POLÍTICA ════════════════════════════════════════════
  { name: 'Poder360',             url: 'https://www.poder360.com.br/feed/',                                  dedicated: true  },
  { name: 'CNN Brasil Política',  url: 'https://www.cnnbrasil.com.br/politica/feed/',                        dedicated: true  },
  { name: 'Metrópoles Política',  url: 'https://www.metropoles.com/politica/feed',                           dedicated: true  },
  { name: 'Congresso em Foco',    url: 'https://congressoemfoco.uol.com.br/feed/',                           dedicated: true  },
  { name: 'O Antagonista',        url: 'https://www.oantagonista.com/feed/',                                 dedicated: true  },
  { name: 'Carta Capital',        url: 'https://www.cartacapital.com.br/feed/',                              dedicated: false },
  { name: 'Correio Braziliense',  url: 'https://www.correiobraziliense.com.br/politica/index.rss',           dedicated: true  },
  { name: 'Jovem Pan Política',   url: 'https://jovempan.com.br/noticias/politica/feed',                     dedicated: true  },
  { name: 'The Intercept BR',     url: 'https://theintercept.com/brasil/feed/',                              dedicated: false },
  { name: 'Gazeta do Povo',       url: 'https://www.gazetadopovo.com.br/ultimas-noticias/feed.xml',          dedicated: false },
  { name: 'Brasil de Fato',       url: 'https://www.brasildefato.com.br/feed.xml',                           dedicated: false },
  { name: 'Agora é Tarde',        url: 'https://agoraeacabou.com.br/feed/',                                  dedicated: false },

  // ══ FONTES INSTITUCIONAIS ═════════════════════════════════════════════════
  { name: 'Agência Brasil',       url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',             dedicated: true  },
  { name: 'Agência Senado',       url: 'https://www12.senado.leg.br/noticias/rss/ultimas',                   dedicated: true  },
  { name: 'Câmara Notícias',      url: 'https://www.camara.leg.br/noticias/rss/',                            dedicated: true  },
  { name: 'Planalto',             url: 'https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/RSS', dedicated: true },
  { name: 'TSE',                  url: 'https://www.tse.jus.br/comunicacao/noticias/rss.xml',                dedicated: true  },

  // ══ GEOPOLÍTICA E RELAÇÕES INTERNACIONAIS ═════════════════════════════════
  { name: 'BBC Brasil',           url: 'https://feeds.bbci.co.uk/portuguese/rss.xml',                        dedicated: false },
  { name: 'Reuters Brasil',       url: 'https://feeds.reuters.com/reuters/BRESTopNews',                      dedicated: false },
  { name: 'Deutsche Welle BR',    url: 'https://rss.dw.com/rdf/rss-br-all',                                  dedicated: false },
  { name: 'RFI Brasil',           url: 'https://www.rfi.fr/br/rss',                                          dedicated: false },
  { name: 'Le Monde Diplo',       url: 'https://www.diplomatique.org.br/feed/',                              dedicated: false },
  { name: 'Nexo Jornal',          url: 'https://www.nexojornal.com.br/feed/',                                dedicated: false },
  { name: 'Piauí',                url: 'https://piaui.folha.uol.com.br/feed/',                               dedicated: false },
  { name: 'Foreign Affairs (EN)', url: 'https://www.foreignaffairs.com/rss.xml',                             dedicated: false },
  { name: 'Al Jazeera English',   url: 'https://www.aljazeera.com/xml/rss/all.xml',                          dedicated: false },
  { name: 'The Guardian World',   url: 'https://www.theguardian.com/world/rss',                              dedicated: false },
  { name: 'Council on For. Rel.', url: 'https://www.cfr.org/rss/all',                                        dedicated: false },
];

// ─── TAXONOMIA DE FILTRO ───────────────────────────────────────────────────────
// Dividido em grupos para facilitar manutenção e scoring futuro

const KEYWORDS_POLITICS_BR = [
  // Atores
  'lula', 'bolsonaro', 'lira', 'pacheco', 'haddad', 'moraes', 'barroso',
  'tarcísio', 'tarcisio', 'gleisi', 'alckmin', 'flávio dino', 'flavio dino',
  'silveira', 'renan', 'calheiros', 'mendonça', 'kassio', 'deolane',
  // Instituições
  'stf', 'supremo', 'congresso', 'senado', 'câmara', 'camara', 'planalto',
  'tcu', 'stj', 'pgr', 'mpf', 'pf ', 'polícia federal', 'policia federal',
  'tribunal superior', 'tse', 'anatel', 'bcb', 'banco central',
  // Processos
  'votação', 'votacao', 'aprovado', 'rejeitado', 'impeachment', 'cassação',
  'cpi', 'pec', 'projeto de lei', ' pl ', 'decreto', 'medida provisória',
  'emenda', 'constituição', 'veto', 'sanção', 'sancao', 'orçamento', 'orcamento',
  'reforma', 'privatização', 'privatizacao', 'licitação', 'contrato',
  // Cargos
  'deputado', 'senador', 'ministro', 'presidente', 'governador', 'prefeito',
  'secretário', 'secretario', 'procurador', 'desembargador',
  // Partidos
  'pt ', ' pt,', 'psd', 'pp ', 'mdb', 'psdb', 'republicans', 'novo ', 'psol',
  'pdт', 'união brasil', 'solidariedade', 'avante', 'progressistas',
  // Economia/política
  'déficit', 'deficit', 'arcabouço', 'arcabouco', 'privatizar', 'supersalário',
  'precatório', 'precatorio', 'desvio', 'corrupção', 'corrupcao', 'propina',
];

const KEYWORDS_GEOPOLITICS = [
  // Conflitos ativos
  'ucrânia', 'ucrania', 'rússia', 'russia', 'gaza', 'israel', 'palestina',
  'líbano', 'libano', 'hezbollah', 'hamas', 'irã', 'ira ', 'iraque',
  'síria', 'siria', 'iêmen', 'iemen', 'taiwan', 'coréia', 'coreia do norte',
  'myanmar', 'sudão', 'sudan', 'congo', 'saara',
  // Potências
  'estados unidos', 'eua ', 'white house', 'trump', 'biden', 'harris',
  'china', 'xi jinping', 'pequim', 'beijing', 'putin', 'kremlin', 'moscou',
  'ue ', 'união europeia', 'otan', 'nato', 'g7', 'g20', 'brics',
  'fundo monetário', 'fmi', 'banco mundial',
  // Relações internacionais
  'sanções', 'sancoes', 'diplomacia', 'embaixador', 'tratado', 'acordo',
  'cúpula', 'cupula', 'reunião de cúpula', 'aliança', 'alianca',
  'geopolítica', 'geopolitica', 'soberania', 'fronteira', 'embargo',
  'guerra comercial', 'tarifa', 'supply chain', 'cadeia produtiva',
  'petróleo', 'petroleo', 'opep', 'commodities', 'grão', 'grao',
  // América Latina
  'venezuela', 'maduro', 'milei', 'argentina', 'colombia', 'petro',
  'chile', 'boric', 'peru', 'bolívia', 'bolivia', 'mercosul',
  'paraguai', 'uruguai', 'equador', 'cuba', 'nicaragua', 'haiti',
];

const ALL_KEYWORDS = [...KEYWORDS_POLITICS_BR, ...KEYWORDS_GEOPOLITICS];

// Normaliza para ASCII para comparação robusta
function toAscii(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRelevant(title = '', description = '') {
  const text = toAscii(title + ' ' + description).toLowerCase();
  return ALL_KEYWORDS.some(kw => text.includes(toAscii(kw).toLowerCase()));
}

// Detecta se item é claramente off-topic (esporte, entretenimento, celebridade)
const BLOCKLIST = [
  'futebol', 'copa do mundo', 'campeonato', 'gol ', 'atacante', 'goleiro',
  'flamengo', 'palmeiras', 'corinthians', 'vasco', 'grêmio', 'internacional',
  'nba', 'nfl', 'formula 1', 'moto gp',
  'oscar', 'grammy', 'bbb ', 'big brother', 'reality show', 'sertanejo',
  'ator', 'atriz', 'cantor', 'cantora', 'novela', 'série', 'filme',
  'receita', 'culinária', 'moda ', 'beleza', 'horóscopo',
  'mercado imobiliário', 'decoração', 'turismo',
];

function isBlocked(title = '', description = '') {
  const text = toAscii(title + ' ' + description).toLowerCase();
  return BLOCKLIST.some(kw => text.includes(toAscii(kw).toLowerCase()));
}

// ─── ENCODING / SANITIZE ──────────────────────────────────────────────────────
function sanitizeText(str) {
  if (!str) return '';
  const s = str.replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();
  if (/[\xC3\xC2][\x80-\xBF]/.test(s) || /Ã[^\s]/.test(s)) return toAscii(s);
  return s;
}

// ─── TAG DO ITEM ──────────────────────────────────────────────────────────────
// Classifica cada item como 'politica-br' ou 'geopolitica' para uso no dashboard
function classifyItem(title = '', description = '') {
  const text = toAscii(title + ' ' + description).toLowerCase();
  const hasBR    = KEYWORDS_POLITICS_BR.some(kw => text.includes(toAscii(kw).toLowerCase()));
  const hasGeo   = KEYWORDS_GEOPOLITICS.some(kw => text.includes(toAscii(kw).toLowerCase()));
  if (hasBR && hasGeo) return 'politica-br'; // prioriza BR quando ambos batem
  if (hasGeo) return 'geopolitica';
  return 'politica-br';
}

// ─── FETCH INDIVIDUAL ─────────────────────────────────────────────────────────
async function fetchSource(source) {
  try {
    const response = await axios.get(source.url, {
      timeout: 14000,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarPolitico/2.0; +https://acropole.com)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Cache-Control': 'no-cache',
      },
    });

    const buf  = Buffer.from(response.data);
    let data   = buf.toString('utf8');
    if (data.includes('\uFFFD')) data = buf.toString('latin1');

    const feed   = await parser.parseString(data);
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48h

    return feed.items
      .filter(item => {
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        if (pubDate <= cutoff) return false;
        const title = item.title || '';
        const desc  = item.contentSnippet || '';
        // Bloqueio explícito antes de qualquer outra checagem
        if (isBlocked(title, desc)) return false;
        if (source.dedicated) return true;
        return isRelevant(title, desc);
      })
      .slice(0, 10)
      .map(item => ({
        id:          uuidv4(),
        source:      source.name,
        category:    classifyItem(item.title || '', item.contentSnippet || ''),
        title:       sanitizeText(item.title || 'Sem título'),
        summary:     sanitizeText((item.contentSnippet || '').replace(/\s+/g, ' ').trim().slice(0, 500)),
        url:         item.link || item.guid || '',
        publishedAt: item.pubDate || new Date().toISOString(),
        status:      'pending',
        generatedPost: null,
        editorialNote: null,
        createdAt:   new Date().toISOString(),
      }));
  } catch (err) {
    console.warn(`[RSS] Falha: ${source.name} — ${err.message}`);
    return [];
  }
}

// ─── FETCH ALL ────────────────────────────────────────────────────────────────
async function fetchAllSources() {
  console.log(`[Worker] Buscando em ${RSS_SOURCES.length} fontes...`);

  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchSource(s)));

  const items = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Deduplicação por URL e por título normalizado
  const seenUrls   = new Set();
  const seenTitles = new Set();

  const unique = items.filter(item => {
    if (item.url && seenUrls.has(item.url)) return false;
    const titleKey = toAscii(item.title).toLowerCase().replace(/[^\w\s]/g, '').slice(0, 80);
    if (seenTitles.has(titleKey)) return false;
    if (item.url) seenUrls.add(item.url);
    seenTitles.add(titleKey);
    return true;
  });

  const byCategory = {
    'politica-br':  unique.filter(i => i.category === 'politica-br').length,
    'geopolitica':  unique.filter(i => i.category === 'geopolitica').length,
  };

  console.log(`[Worker] ${unique.length} itens únicos (${items.length} brutos) — BR: ${byCategory['politica-br']} | Geo: ${byCategory['geopolitica']}`);
  return unique;
}

module.exports = { fetchAllSources };
