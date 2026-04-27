exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (!apiKey) {
      return json(500, { error: 'GEMINI_API_KEY não configurada' });
    }

    const body = JSON.parse(event.body || '{}');
    const {
      task,
      subject,
      text,
      quantity = 10,
      mode = 'misto'
    } = body;

    if (!task) {
      return json(400, { error: 'Tarefa não informada' });
    }

    if (!text || text.trim().length < 180) {
      return json(400, { error: 'Texto insuficiente para análise inteligente' });
    }

    let prompt = '';

    if (task === 'study-guide') {
      prompt = buildStudyGuidePrompt(subject, text);
    } else if (task === 'quiz') {
      prompt = buildQuizPrompt(subject, text, quantity, mode);
    } else {
      return json(400, { error: 'Tarefa inválida' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
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
            temperature: task === 'quiz' ? 0.35 : 0.2,
            maxOutputTokens: task === 'quiz' ? 8000 : 4000,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return json(response.status, {
        error: 'Erro na Gemini API',
        details: data
      });
    }

    const outputText =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        ?.join('\n')
        ?.trim() || '';

    if (!outputText) {
      return json(500, { error: 'Gemini não retornou texto' });
    }

    let parsed;

    try {
      parsed = JSON.parse(cleanJson(outputText));
    } catch (err) {
      return json(500, {
        error: 'Gemini respondeu fora do formato esperado',
        raw: outputText
      });
    }

    return json(200, parsed);

  } catch (error) {
    return json(500, {
      error: 'Erro interno',
      details: error.message
    });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
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

function buildStudyGuidePrompt(subject, text) {
  return `
Você é uma IA de alto nível especializada em estudo acadêmico, revisão estratégica e preparação para provas.

MATÉRIA:
${subject || 'não informada'}

MISSÃO:
Transformar o conteúdo abaixo em um GUIA DE ESTUDO INTELIGENTE.

REGRAS:
- Não faça resumo literal do PDF.
- Não copie frases aleatórias do material.
- Não copie enunciados de questões.
- Ignore alternativas, gabaritos, numeração, cabeçalhos, rodapés, sumário e bibliografia.
- Foque somente no conteúdo real e útil para estudar.
- Explique o conteúdo como se estivesse preparando uma aluna para prova.
- Identifique conceitos centrais.
- Diga o que costuma cair.
- Aponte pegadinhas.
- Organize a prioridade do estudo.
- Faça perguntas rápidas para revisão ativa.
- Seja clara, útil e objetiva.

RETORNE APENAS JSON VÁLIDO, sem markdown, neste formato:

{
  "subject": "Nome da matéria",
  "concepts": [
    {
      "term": "Nome do conceito",
      "context": "Explicação clara e didática do conceito com base no conteúdo",
      "why_it_matters": "Por que isso importa e como costuma cair em prova"
    }
  ],
  "pontos_de_prova": [
    "Ponto importante que tem chance de cair em prova"
  ],
  "pegadinhas": [
    "Erro comum, confusão provável ou detalhe perigoso"
  ],
  "resumo_ativo": [
    "Frase curta para revisão ativa"
  ],
  "prioridade_de_estudo": [
    "O que estudar primeiro, em ordem, com justificativa"
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
Você é uma IA especialista em criar questões de prova acadêmica.

MATÉRIA:
${subject || 'não informada'}

QUANTIDADE:
${quantity}

MODO:
${mode}

MISSÃO:
Criar questões realmente úteis para estudar, com cara de prova real.

REGRAS OBRIGATÓRIAS:
- Use SOMENTE o conteúdo fornecido.
- Não copie questões prontas.
- Não copie enunciados do PDF.
- Não transforme alternativas antigas em novas questões.
- Crie questões novas e objetivas.
- Cada questão deve ter 5 alternativas.
- Apenas 1 alternativa correta.
- As alternativas erradas devem ser plausíveis.
- A explicação deve ensinar o conteúdo.
- A questão deve cobrar raciocínio, não memorização solta.
- Faça enunciados objetivos.
- Evite alternativas longas.
- A explicação deve ter no máximo 2 frases.
- Não use textos enormes nas alternativas.

VARIE ENTRE:
- definição de conceito
- função de um conceito
- comparação entre conceitos parecidos
- causa e consequência
- aplicação em situação prática
- pegadinhas
- interpretação do conteúdo
- associação entre tema e característica

NÃO FAÇA QUESTÕES FRACAS COMO:
- "qual palavra aparece no texto?"
- "qual termo foi citado?"
- "qual alternativa contém um conceito?"

RETORNE APENAS JSON VÁLIDO, sem markdown, neste formato:

{
  "questions": [
    {
      "statement": "Enunciado novo, claro e com cara de prova",
      "alternatives": [
        "Alternativa A",
        "Alternativa B",
        "Alternativa C",
        "Alternativa D",
        "Alternativa E"
      ],
      "correctIndex": 0,
      "explanation": "Explicação curta e didática",
      "studyPoint": "Ponto do conteúdo cobrado",
      "difficulty": "fácil | médio | difícil"
    }
  ]
}

CONTEÚDO:
${text}
`;
}
