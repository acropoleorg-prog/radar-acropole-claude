// generator.js
const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');
const cheerio   = require('cheerio');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BRAND_NAME     = process.env.BRAND_NAME      || 'Acrópole';
const HANDLE_X       = process.env.BRAND_HANDLE_X  || '@acropole';
const POST_TONE      = process.env.POST_TONE        || 'informativo';
const EDITORIAL_VOICE = process.env.EDITORIAL_VOICE || 'acropole';

// ─── VOZES EDITORIAIS ─────────────────────────────────────────────────────────
const VOICE_PROFILES = {
  acropole: `
Você é o editor-chefe da ${BRAND_NAME}, publicação de análise política e geopolítica reconhecida por:
- Profundidade analítica sem academicismo — você transforma complexidade em clareza
- Voz de autoridade que nunca soa arrogante
- Capacidade de identificar o que a cobertura mainstream ignora ou suaviza
- Comprometimento com o fato, sem militância — mas com perspectiva clara`,

  intercept: `
Você é um repórter investigativo que escreve para um público sofisticado.
- Vai direto ao conflito de interesses, ao poder real por trás do fato
- Não tem medo de nomear quem se beneficia
- Tom crítico, preciso, sem sensacionalismo`,

  folha: `
Você é um colunista de referência de jornal de grande circulação.
- Jornalístico, denso em dados, sem floreio
- Contextualiza historicamente com economia de palavras
- Neutralidade de aparência, mas com perspectiva editorial clara`,
};

// ─── TONS DE POST ─────────────────────────────────────────────────────────────
const TONE_GUIDE = {
  informativo: 'Jornalístico, preciso, ancorado em dados. Evite julgamentos explícitos. Deixe o fato falar.',
  opinativo:   'Analítico e assertivo. Tome partido quando o fato exigir. Mostre o que outros não estão dizendo.',
  urgente:     'Breaking news. Verbos no presente. Sensação de que algo importante está acontecendo agora.',
  irônico:     'Ironia inteligente, sem cinismo vazio. Use o absurdo do fato contra ele mesmo.',
};

// ─── SCRAPING DO ARTIGO ───────────────────────────────────────────────────────
async function fetchArticleContent(url) {
  if (!url) return '';
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      responseEncoding: 'utf8',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
      },
      maxContentLength: 4 * 1024 * 1024,
    });

    const $ = cheerio.load(data);

    $('script, style, nav, header, footer, aside, figure, figcaption, noscript, ' +
      '[class*="ad-"], [class*="banner"], [class*="cookie"], [class*="newsletter"], ' +
      '[class*="related"], [class*="leia-mais"], [class*="veja-mais"], ' +
      '[class*="share"], [class*="social"], [class*="comentarios"], ' +
      '[id*="cookie"], [id*="newsletter"], [id*="comments"], [class*="paywall"]'
    ).remove();

    const SELECTORS = [
      '.content-text__body', '.article-body__content',
      '[class*="article-body"]', '[class*="article-content"]',
      '.c-news__body', '[class*="ARTICLE_BODY"]',
      '[data-testid="article-body"]', '[class*="post-content"]',
      '[class*="entry-content"]', '[class*="materia-body"]',
      '[class*="conteudo-materia"]', '[class*="news-body"]',
      'article', '[role="main"]', 'main',
    ];

    let paragraphs = [];
    for (const sel of SELECTORS) {
      const el = $(sel).first();
      if (!el.length) continue;
      const ps = el.find('p')
        .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(t => t.length > 60 &&
          !/^(leia (também|mais)|veja (também|mais)|saiba mais|publicidade|foto:|crédito:|assine)/i.test(t));
      if (ps.length >= 3) { paragraphs = ps; break; }
    }

    if (paragraphs.length < 3) {
      paragraphs = $('p').map((_, p) => $(p).text().replace(/\s+/g, ' ').trim()).get().filter(t => t.length > 60);
    }

    return paragraphs.slice(0, 20).join('\n\n').slice(0, 5000);
  } catch (err) {
    console.warn('[Generator] Scraping falhou:', err.message);
    return '';
  }
}

// ─── SISTEMA DE PROMPTS ───────────────────────────────────────────────────────
function buildSystemPrompt() {
  const voice = VOICE_PROFILES[EDITORIAL_VOICE] || VOICE_PROFILES.acropole;
  return `${voice}

MISSÃO GERAL:
Você transforma notícias de política e geopolítica em posts de alto impacto para o X (Twitter).
Seu output deve soar como um ser humano inteligente que entende mais do que a mídia mostra — nunca como IA, nunca como press release.

PRINCÍPIOS FUNDAMENTAIS:
1. O hook é sagrado — a primeira linha decide se o post é ignorado ou compartilhado
2. Todo dado concreto vale mais que dez adjetivos (placar, valor, percentual, data, nome)
3. Contexto em uma frase: "pela 2ª vez", "primeiro desde 2019", "aprovado por 312×97"
4. Voz ativa sempre: "O Senado aprovou" nunca "foi aprovado"
5. O leitor deve sair do post sabendo mais do que entrou — e querendo compartilhar

PROIBIDO:
- Emojis de qualquer tipo
- Hashtags genéricas como #Política #Brasil #Governo
- Frases de press release: "foi realizado", "deu início", "tem como objetivo"
- Opiniões vagas sem dados: "é preocupante", "gera debate", "divide opiniões"
- Começar com o nome da publicação ou handle`;
}

function buildUserPrompt(item, articleContent) {
  const tone     = TONE_GUIDE[POST_TONE] || TONE_GUIDE.informativo;
  const category = item.category === 'geopolitica' ? 'GEOPOLÍTICA / RELAÇÕES INTERNACIONAIS' : 'POLÍTICA BRASILEIRA';

  const contentBlock = articleContent.length > 300
    ? `CONTEÚDO COMPLETO DA MATÉRIA:\n${articleContent}`
    : `RESUMO DO RSS (artigo inacessível ou paywall):\n${item.summary || 'Sem resumo disponível.'}`;

  return `CATEGORIA: ${category}
FONTE: ${item.source}
TÍTULO: ${item.title}
URL: ${item.url || 'N/A'}

${contentBlock}

═══════════════════════════════════════
TAREFA: Gerar post para o X

TOM: ${tone}

ESTRUTURA OBRIGATÓRIA DO POST ÚNICO (máx. 280 chars):
1. HOOK — primeira linha que para o scroll. Pode ser: dado chocante, contradição, pergunta retórica, revelação. Nunca repita o título.
2. CORPO — 1-2 linhas com o dado que ancora o fato ou o contexto que falta
3. CONCLUSÃO — o que isso significa ou por que o leitor deve se importar

HANDLE: sempre ao final → ${HANDLE_X}
HASHTAGS: exatamente 2, específicas ao tema (ex: #STF #ReformaAdministrativa — NUNCA #Política #Brasil)

AVALIE TAMBÉM SE É CASO DE THREAD:
Uma thread vale quando: há múltiplos desdobramentos, sequência de eventos, ou contexto que não cabe em 280 chars.
Se achar que thread é melhor, gere até 4 tweets numerados (1/4, 2/4 etc.) — cada um com máx. 280 chars.

═══════════════════════════════════════
Responda SOMENTE com JSON válido, sem markdown, sem texto fora do JSON:

{
  "format": "single" ou "thread",
  "post": "texto do post único completo (se format=single)",
  "thread": ["tweet 1/N", "tweet 2/N", "..."] (se format=thread, array com os tweets),
  "char_count": número de caracteres do post (ou do tweet mais longo, se thread),
  "hook_type": "dado_concreto" | "contradição" | "revelação" | "urgência" | "ironia",
  "editorial_note": "em 1-2 frases: qual ângulo você escolheu e por que ele é o mais noticioso"
}`;
}

// ─── GERAÇÃO PRINCIPAL ────────────────────────────────────────────────────────
async function generatePost(item) {
  const articleContent = item.url ? await fetchArticleContent(item.url) : '';

  try {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 800,
      system:     buildSystemPrompt(),
      messages:   [{ role: 'user', content: buildUserPrompt(item, articleContent) }],
    });

    const raw   = response.content[0].text.trim();
    const clean = raw.replace(/^```(?:json)?|```$/gm, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON não encontrado na resposta');

    const parsed = JSON.parse(match[0]);

    // Garante 280 chars no post único
    if (parsed.format === 'single' && parsed.post && parsed.post.length > 280) {
      console.warn(`[Generator] Post com ${parsed.post.length} chars — truncando`);
      parsed.post = parsed.post.slice(0, 277) + '…';
    }

    // Garante 280 chars por tweet na thread
    if (parsed.format === 'thread' && Array.isArray(parsed.thread)) {
      parsed.thread = parsed.thread.map(t => t.length > 280 ? t.slice(0, 277) + '…' : t);
    }

    return parsed;

  } catch (err) {
    console.error('[Generator] Erro:', err.message);
    return {
      format:        'single',
      post:          `${item.title.slice(0, 200)} ${HANDLE_X} #política #geopolítica`,
      char_count:    null,
      hook_type:     'fallback',
      editorial_note: `Geração automática falhou: ${err.message}`,
    };
  }
}

// ─── BATCH COM CONCORRÊNCIA LIMITADA ──────────────────────────────────────────
async function generateBatchPosts(items) {
  const results     = [];
  const CONCURRENCY = 2;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch        = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(item => generatePost(item)));

    batchResults.forEach((r, idx) => {
      results.push({
        id:    batch[idx].id,
        post:  r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected'  ? r.reason.message : null,
      });
    });

    if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

module.exports = { generatePost, generateBatchPosts };
