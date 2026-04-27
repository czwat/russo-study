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
    const { task, subject, text, quantity = 10, mode = 'misto' } = body;

    if (!task) {
      return json(400, { error: 'Tarefa não informada' });
    }

    if (!text || text.trim().length < 200) {
      return json(400, { error: 'Texto insuficiente para análise inteligente' });
    }

    let prompt = '';

    if (task === 'study-guide') {
      prompt = buildStudyGuidePrompt(subject, text);
    }

    if (task === 'quiz') {
      prompt = buildQuizPrompt(subject, text, quantity, mode);
    }

    if (!prompt) {
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
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: task === 'quiz' ? 0.45 : 0.25,
            maxOutputTokens: task === 'quiz' ? 60000 : 16000,
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
    } catch {
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
Você é uma IA especialista em estudo acadêmico, revisão estratégica e preparação para provas.

Analise o conteúdo da matéria: "${subject || 'não informada'}".

OBJETIVO:
Transformar o material em um guia de estudo inteligente.

REGRAS:
- Não faça resumo literal.
- Não copie enunciados de questões.
- Ignore alternativas, gabaritos, numeração, rodapés e cabeçalhos.
- Foque no conteúdo real que a aluna precisa aprender.
- Extraia o que costuma cair em prova.
- Explique conceitos de forma clara.
- Aponte pegadinhas.
- Diga o que estudar primeiro.
- Pense como um professor preparando revisão antes da prova.

RETORNE APENAS JSON VÁLIDO, sem markdown, neste formato:

{
  "subject": "Nome da matéria",
  "concepts": [
    {
      "term": "Nome do conceito",
      "context": "Explicação clara do conceito com base no material",
      "why_it_matters": "Por que esse conceito costuma cair em prova"
    }
  ],
  "pontos_de_prova": [
    "Ponto importante que pode cair em prova"
  ],
  "pegadinhas": [
    "Confusão comum ou detalhe perigoso"
  ],
  "resumo_ativo": [
    "Frase curta para revisão ativa"
  ],
  "prioridade_de_estudo": [
    "O que estudar primeiro e por quê"
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

Crie ${quantity} questões objetivas sobre a matéria: "${subject || 'não informada'}".

MODO:
${mode}

REGRAS:
- Use SOMENTE o conteúdo fornecido.
- Não copie questões prontas do PDF.
- Não copie enunciados antigos.
- Não transforme alternativas antigas em novas questões.
- Crie questões novas, com cara de prova real.
- Cada questão deve ter 5 alternativas.
- Apenas 1 alternativa correta.
- Cobre entendimento real, não memorização solta.
- Varie entre definição, aplicação, comparação, consequência, causa e efeito, pegadinhas e interpretação.
- As alternativas erradas devem ser plausíveis.
- A explicação deve ensinar.

RETORNE APENAS JSON VÁLIDO, sem markdown, neste formato:

{
  "questions": [
    {
      "statement": "Enunciado da questão",
      "alternatives": [
        "Alternativa A",
        "Alternativa B",
        "Alternativa C",
        "Alternativa D",
        "Alternativa E"
      ],
      "correctIndex": 0,
      "explanation": "Explicação clara do gabarito",
      "studyPoint": "Ponto do conteúdo que essa questão cobra",
      "difficulty": "fácil | médio | difícil"
    }
  ]
}

CONTEÚDO:
${text}
`;
}
