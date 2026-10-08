import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schemas/lesson.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat('date', value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const check = ajv.compile(schema);

function plainText(markdown) {
  return markdown
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

function markdownRef(section, span, anchor) {
  return { ...section.source, span, anchor };
}

function content(markdown, sourceRef, derivation = { type: 'extract' }) {
  return { markdown, plainText: plainText(markdown), sourceRef, derivation };
}

function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function headingSections(topic) {
  const found = [];
  for (const section of topic.sections) {
    const markdown = section.markdown;
    const lines = markdown.split(/\r\n|\n|\r/);
    let offset = 0;
    let fence = null;
    let current = null;
    for (const line of lines) {
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
      } else if (!fence) {
        const match = line.match(/^###\s+(\d+\.\d+)\s+(.+?)\s*#*\s*$/);
        if (match) {
          if (current) current.end = section.source.span.start + offset;
          const start = section.source.span.start + offset;
          const titleStart = offset + line.indexOf(match[2]);
          current = {
            id: `${topic.id}:${section.id}:${match[1]}`,
            title: match[2].trim(),
            start,
            titleStart: section.source.span.start + titleStart,
            end: section.source.span.end,
            markdown: '',
            section,
            anchor: match[1]
          };
          found.push(current);
        }
      }
      offset += line.length + (markdown.slice(offset + line.length, offset + line.length + 2) === '\r\n' ? 2 : 1);
    }
    if (current) current.end = section.source.span.start + markdown.length;
    for (const item of found.filter(entry => entry.section === section)) {
      const localStart = item.start - section.source.span.start;
      const localEnd = item.end - section.source.span.start;
      item.markdown = markdown.slice(localStart, localEnd).trim();
    }
  }
  return found;
}

function canonicalSpan(topic, section, start, end) {
  const startLine = lineAt(topic.rawMarkdown, start);
  const endLine = lineAt(topic.rawMarkdown, Math.max(start, end - 1));
  return { start, end, startLine, endLine };
}

function quizQuestion(q) {
  if (q.correctIndex < 0 || q.correctIndex >= q.alternatives.length) {
    throw new Error(`correctIndex inválido em ${q.id}`);
  }
  return {
    id: q.id,
    kind: 'recall',
    difficulty: q.difficulty,
    question: q.question,
    answer: q.alternatives[q.correctIndex],
    explanation: q.explanation,
    sourceRef: { path: q.source.path, sha256: q.source.sha256, pointer: q.source.pointer },
    followUps: []
  };
}

function isEd01(topic) {
  return topic.domain === 'engenharia-de-dados'
    && topic.order === 1
    && topic.source.path === 'engenharia-de-dados/01-modelagem-de-dados.md';
}

function normalizeAuditReport(input) {
  if (input?.json && typeof input.json === 'object') return input.json;
  return input;
}

function auditBinding(topic, input) {
  if (!input) return { status: 'missing', warning: 'Relatório de auditoria ausente; fontes externas não anexadas.' };
  const report = normalizeAuditReport(input);
  if (!report || typeof report !== 'object' || !report.validation || !report.topicBinding) {
    return { status: 'invalid', warning: 'Formato do relatório inválido; fontes externas não anexadas.' };
  }
  const sourceMatches = report.topic?.id === topic.id
    && report.topic?.source?.path === topic.source.path
    && report.topicBinding.currentSource?.path === topic.source.path
    && report.topicBinding.currentSource?.sha256 === topic.source.sha256
    && report.topicBinding.sourceHash === topic.source.sha256
    && report.topic?.source?.sha256 === topic.source.sha256;
  const logicalMatches = report.topicBinding.logicalSnapshotHashMatches === true;
  if (report.validation.valid !== true) {
    return { status: 'invalid', warning: 'Validação do relatório falhou; fontes externas não anexadas.' };
  }
  if (report.topicBinding.matches !== true || !sourceMatches || !logicalMatches) {
    return { status: 'stale', warning: 'Relatório inválido, stale ou vinculado a outro snapshot; fontes externas não anexadas.' };
  }
  const sources = (Array.isArray(report.externalSources) ? report.externalSources : []).filter(source =>
    source && source.sourceHash === topic.source.sha256
    && source.logicalSnapshotHashMatches === true
    && source.logicalSnapshotHash === report.topicBinding.logicalSnapshotHash
    && typeof source.type === 'string' && typeof source.url === 'string'
    && source.url.startsWith('https://') && typeof source.title === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt)
    && typeof source.locator === 'string'
    && Array.isArray(source.claimIds) && Array.isArray(source.verifiedClaimIds)
    && Array.isArray(source.claimStatuses));
  return { status: 'bound', report, sources };
}

export function buildLesson(topic, auditReport) {
  if (!topic || !Array.isArray(topic.sections) || !topic.source) {
    throw new TypeError('Esperado StudyTopic canônico');
  }
  const headings = headingSections(topic);
  const audit = auditBinding(topic, auditReport);
  const findHeading = (number) => headings.find(item => item.anchor === number);
  const toConcept = item => ({
    id: item.id,
    title: item.title,
    ...content(item.markdown, markdownRef(item.section,
      canonicalSpan(topic, item.section, item.start, item.end), item.anchor))
  });
  const concepts = headings.map(toConcept).filter(item => item.markdown.length > 0);
  const sourceContent = headings.map(item => item.markdown).join('\n\n');
  const sourceRef = headings.length
    ? markdownRef(headings[0].section,
      canonicalSpan(topic, headings[0].section, headings[0].start, headings[0].end), headings[0].anchor)
    : { ...topic.source, span: { start: 0, end: topic.rawMarkdown.length, startLine: 1, endLine: topic.rawMarkdown.split(/\r\n|\n|\r/).length }, anchor: 'topic' };

  let objectives = headings.slice(0, 3).map(item => content(
    item.markdown, markdownRef(item.section,
      canonicalSpan(topic, item.section, item.start, item.end), item.anchor)));
  let summary = content(sourceContent, sourceRef);
  let recap = headings.slice(-3).map(item => content(
    item.markdown, markdownRef(item.section,
      canonicalSpan(topic, item.section, item.start, item.end), item.anchor)));
  let examples = [];
  if (isEd01(topic)) {
    const scd = findHeading('1.7');
    const grain = findHeading('1.4');
    if (scd) examples.push(content(
      'Cenário derivado: um cliente muda de cidade. Se uma venda antiga deve preservar a cidade vigente no evento, SCD Tipo 2 cria nova versão com surrogate key distinta; o fato antigo continua apontando à versão anterior.',
      markdownRef(scd.section, canonicalSpan(topic, scd.section, scd.start, scd.end), scd.anchor),
      { type: 'authored', rationale: 'Aplicação do cenário SCD Tipo 2 descrito na seção de origem; sem fatos externos.' }
    ));
    if (grain) examples.push(content(
      '“Uma linha por item de pedido” e “uma linha por pedido” são grãos diferentes; declare o grão antes das dimensões e métricas.',
      markdownRef(grain.section, canonicalSpan(topic, grain.section, grain.start, grain.end), grain.anchor),
      { type: 'authored', rationale: 'Reformulação didática do contraste explícito na fonte.' }
    ), content(
      'Para uma taxa, agregue numerador e denominador e calcule a razão após a agregação; não tire média simples de médias de grupos com tamanhos diferentes.',
      markdownRef(grain.section, canonicalSpan(topic, grain.section, grain.start, grain.end), grain.anchor),
      { type: 'authored', rationale: 'Aplicação da regra de métricas não aditivas descrita na seção de fatos.' }
    ));
  }

  const questions = [];
  for (const q of topic.interviewQuestions ?? []) {
    questions.push({
      id: q.id,
      kind: q.kind === 'scenario' || q.kind === 'case-study' ? 'scenario' : 'conceptual',
      difficulty: q.difficulty,
      question: q.question,
      answer: q.modelAnswer,
      explanation: q.modelAnswer ?? '',
      sourceRef: { ...q.source },
      followUps: (q.followUps ?? []).map(f => ({
        question: f.question,
        answer: f.answer ?? null,
        sourceRef: { ...q.source, span: { ...f.source } }
      }))
    });
  }
  for (const q of topic.quizQuestions ?? []) questions.push(quizQuestion(q));
  if (isEd01(topic)) {
    const questionById = id => questions.find(q => q.id === id);
    const qScd = questionById('ED-01-P5') ?? questions.find(q => /SCD Tipo 1, 2 e 3/i.test(q.question));
    const qMetric = questions.find(q => /percentual|taxa de conversão/i.test(q.question));
    const qStar = questions.find(q => /star ou snowflake/i.test(q.question));
    const qTrap = questions.find(q => /armadilhas/i.test(q.question)) ?? questions.find(q => /SCD Tipo 2/i.test(q.question));
    if (qScd) qScd.kind = 'application';
    if (qMetric) qMetric.kind = 'comparison';
    if (qStar) qStar.kind = 'comparison';
    if (qTrap) {
      questions.push({ ...qTrap, id: `${qTrap.id}:find-error`, kind: 'find-error',
        question: 'Um fato histórico foi associado à versão corrente da dimensão usando flag_atual=true. Identifique o erro e a correção.',
        answer: 'O lookup pode atribuir contexto atual ao evento antigo. Selecione a versão cujo intervalo semiaberto contém a data do evento.',
        explanation: 'A fonte descreve o lookup temporal por data_inicio_validade <= data_evento < data_fim_validade e alerta que o erro é silencioso.',
        followUps: [], derivation: { type: 'authored', rationale: 'Exercício contrafactual sobre o erro temporal descrito na seção referenciada.' } });
    }
    const scd = findHeading('1.7');
    if (scd) questions.push({
      id: `${topic.id}:scenario-city-scd2`, kind: 'scenario', difficulty: 'intermediate',
      question: 'Um cliente muda de cidade em junho. Como garantir que as vendas de janeiro continuem associadas à cidade antiga?',
      answer: 'Use SCD Tipo 2: crie uma nova linha com nova surrogate key e validade a partir da mudança; a venda de janeiro aponta para a versão vigente na data do evento.',
      explanation: 'Resposta derivada da seção SCD2: nova versão, surrogate key e contexto histórico no momento do evento.',
      sourceRef: markdownRef(scd.section, canonicalSpan(topic, scd.section, scd.start, scd.end), scd.anchor),
      followUps: [], derivation: { type: 'authored', rationale: 'Cenário explícito na fonte, adaptado para cidade e data.' }
    });
  }

  const pitfallsSection = topic.sections.find(s => /armadilhas/i.test(s.title));
  const pitfalls = pitfallsSection ? [content(pitfallsSection.markdown, pitfallsSection.source)] : [];
  const lesson = {
    id: `lesson:${topic.id}`, schemaVersion: 1, domain: topic.domain,
    sourceTopic: topic.id, difficulty: 'mixed', title: topic.title,
    source: { ...topic.source }, objectives, summary, concepts, examples,
    questions, pitfalls, recap, sources: [{ ...topic.source }],
    externalSources: audit.status === 'bound' ? audit.sources : [],
    audit: audit.status === 'bound'
      ? { coverage: audit.report.coverage, counts: audit.report.counts, bindingStatus: audit.status }
      : { bindingStatus: audit.status, warning: audit.warning },
    verificationStatus: topic.metadata?.verification?.status ?? 'unverified'
  };
  return lesson;
}

export function validateLesson(lesson, topic) {
  const valid = check(lesson);
  const errors = (check.errors ?? []).map(e => ({ message: e.message ?? 'inválido', instancePath: e.instancePath }));
  for (const [index, source] of (lesson?.externalSources ?? []).entries()) {
    if (source.sourceHash !== lesson.source?.sha256 || source.logicalSnapshotHashMatches !== true) {
      errors.push({ message: 'fonte externa não está vinculada ao snapshot da lesson', instancePath: `/externalSources/${index}` });
    }
  }
  if (topic && valid) {
    const checkRef = (ref, path) => {
      if (ref.path.endsWith('.json')) {
        const q = topic.quizQuestions?.find(item => item.source.path === ref.path && item.source.pointer === ref.pointer);
        if (!q || q.source.sha256 !== ref.sha256) errors.push({ message: 'quiz pointer/hash não resolvido', instancePath: path });
      } else {
        if (ref.path !== topic.source.path || ref.sha256 !== topic.source.sha256) errors.push({ message: 'source path/hash não corresponde ao tópico', instancePath: path });
        if (ref.span.end > topic.rawMarkdown.length || ref.span.start > ref.span.end) errors.push({ message: 'source span fora do conteúdo', instancePath: path });
        else if (/^\d+\.\d+$/.test(ref.anchor)
          && !topic.rawMarkdown.slice(ref.span.start, ref.span.end).includes(`### ${ref.anchor}`)) {
          errors.push({ message: 'section anchor não corresponde ao source span', instancePath: path });
        }
      }
    };
    const walk = (value, path = '') => {
      if (!value || typeof value !== 'object') return;
      if (value.sourceRef) checkRef(value.sourceRef, `${path}/sourceRef`);
      if (value.source && value.source.span) checkRef(value.source, `${path}/source`);
      for (const [key, child] of Object.entries(value)) {
        if (key === 'sourceRef' || key === 'source') continue;
        if (Array.isArray(child)) child.forEach((entry, i) => walk(entry, `${path}/${key}/${i}`));
        else if (child && typeof child === 'object') walk(child, `${path}/${key}`);
      }
    };
    walk(lesson);
  }
  return { valid: Boolean(valid) && errors.length === 0, errors };
}

export function serialiseLesson(lesson) {
  const result = validateLesson(lesson);
  if (!result.valid) throw new TypeError(`StudyLesson inválida: ${JSON.stringify(result.errors)}`);
  return `${JSON.stringify(lesson, null, 2)}\n`;
}
