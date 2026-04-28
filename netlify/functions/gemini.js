exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';

    if (!apiKey) {
      return json(500, { error: 'GEMINI_API_KEY não configurada no Netlify' });
    }

    const body = JSON.parse(event.body || '{}');

    const task = body.task;
    const subject = body.subject || 'Matéria não informada';
    const text = compactText(body.text || '', task === 'quiz' ? 7000 : 9000);
    const quantity = Math.min(Number(body.quantity || 10), 10);
    const mode = body.mode || 'misto';

    if (!task) {
      return json(400, { error: 'Tarefa não informada' });
    }

    if (!text || text.trim().length < 120) {
      return json(400, { error: 'Texto insuficiente para análise' });
    }

    let prompt;

    if (task === 'study-guide') {
      prompt = buildStudyGuidePrompt(subject, text);
    } else if (task === 'quiz') {
      prompt = buildQuizPrompt(subject, text, quantity, mode);
    } else {
      return json(400, { error: 'Tarefa inválida' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);

    let response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: task === 'quiz' ? 0.25 : 0.2,
              maxOutputTokens: task === 'quiz' ? 4500 : 3000,
              responseMimeType: 'application/json'
            }
          })
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return json(response.status, {
        error: 'Erro na Gemini API',
        details: data || null
      });
    }

    const outputText =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        ?.join('\n')
        ?.trim() || '';

    if (!outputText) {
      return json(500, { error: 'Gemini não retornou texto' });
    }

    let parsed;

    try {
      parsed = JSON.parse(cleanJson(outputText));
    } catch {
      return json(500, {
        error: 'Gemini respondeu fora do JSON esperado',
        raw: outputText.slice(0, 1500)
      });
    }

    return json(200, parsed);

  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Tempo excedido ao chamar Gemini'
      : error.message;

    return json(500, {
      error: 'Erro interno na função',
      details: message
    });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function cleanJson(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function compactText(text, maxChars) {
  text = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxChars) return text;

  const startSize = Math.floor(maxChars * 0.50);
  const middleSize = Math.floor(maxChars * 0.30);
  const endSize = Math.floor(maxChars * 0.20);

  const start = text.slice(0, startSize);
  const middleStart = Math.floor(text.length * 0.45);
  const middle = text.slice(middleStart, middleStart + middleSize);
  const end = text.slice(-endSize);

  return `
INÍCIO DO MATERIAL:
${start}

TRECHO CENTRAL:
${middle}

FINAL DO MATERIAL:
${end}
`;
}

function buildStudyGuidePrompt(subject, text) {
  return `
Você é uma IA especialista em estudo acadêmico, revisão estratégica e preparação para provas.

MATÉRIA:
${subject}

OBJETIVO:
Transformar o conteúdo em um guia de estudo inteligente, útil e direto.

REGRAS:
- Não faça resumo literal.
- Não copie enunciados de questões.
- Ignore alternativas, gabaritos, cabeçalhos, rodapés, bibliografia, numeração e textos administrativos.
- Foque no conteúdo real que a aluna precisa estudar.
- Explique conceitos de forma clara.
- Separe o que costuma cair em prova.
- Aponte pegadinhas.
- Diga o que estudar primeiro.
- Seja objetiva.

RETORNE APENAS JSON VÁLIDO, sem markdown, neste formato:

{
  "subject": "Nome da matéria",
  "concepts": [
    {
      "term": "Conceito",
      "context": "Explicação clara e didática",
      "why_it_matters": "Como isso costuma cair em prova"
    }
  ],
  "pontos_de_prova": [
    "Ponto importante para prova"
  ],
  "pegadinhas": [
    "Pegadinha ou erro comum"
  ],
  "resumo_ativo": [
    "Frase curta para revisão ativa"
  ],
  "prioridade_de_estudo": [
    "O que estudar primeiro"
  ],
  "perguntas_rapidas": [
    "Pergunta curta para autoavaliação"
  ]
}

CONTEÚDO:
${text}
`;
}

function buildQuizPrompt(subject, text, quantity, mode) {
  return `
Você é uma IA especialista em criar questões de prova.

MATÉRIA:
${subject}

QUANTIDADE:
${quantity}

MODO:
${mode}

REGRAS:
- Use SOMENTE o conteúdo fornecido.
- Não copie questões prontas.
- Não copie enunciados do PDF.
- Crie questões novas, objetivas e com cara de prova.
- Cada questão deve ter 5 alternativas.
- Apenas 1 alternativa correta.
- As alternativas erradas devem ser plausíveis.
- A explicação deve ter no máximo 2 frases.
- Evite enunciados e alternativas longas.
- Cobre conceito, função, comparação, aplicação, consequência e pegadinhas.

NÃO FAÇA QUESTÕES FRACAS COMO:
- "Qual palavra aparece no texto?"
- "Qual termo foi citado?"
- "Qual alternativa contém um conceito?"

RETORNE APENAS JSON VÁLIDO, sem markdown, neste formato:

{
  "questions": [
    {
      "statement": "Enunciado novo e objetivo",
      "alternatives": [
        "Alternativa A",
        "Alternativa B",
        "Alternativa C",
        "Alternativa D",
        "Alternativa E"
      ],
      "correctIndex": 0,
      "explanation": "Explicação curta do gabarito",
      "studyPoint": "Ponto do conteúdo cobrado",
      "difficulty": "fácil | médio | difícil"
    }
  ]
}

CONTEÚDO:
${text}
`;
}
