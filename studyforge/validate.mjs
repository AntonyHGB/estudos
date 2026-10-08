import { Ajv2020 } from 'ajv/dist/2020.js';
import topicSchema from './schemas/topic.schema.json' with { type: 'json' };
import quizSchema from './schemas/quiz.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateCanonical = ajv.compile(topicSchema);
const validateQuizBank = ajv.compile(quizSchema);

function schemaErrors(validate, value) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => ({
    code: `SCHEMA_${String(error.keyword).toUpperCase()}`,
    message: `${error.instancePath || '/'} ${error.message ?? 'invalid'}`,
    path: error.instancePath || '/',
  }));
}

/** Validate the fully canonical StudyTopic, including schema and cross-field invariants. */
export function validateTopic(topic) {
  const legacyQuiz = Array.isArray(topic?.quizQuestions) && topic.quizQuestions.some((q) => q && 'q' in q && !('question' in q));
  const candidate = legacyQuiz ? { ...topic, quizQuestions: topic.quizQuestions.map((q) => q && ({
    id: q.id, theme: q.theme, index: q.index, difficulty: ({ '🟢': 'basic', '🟡': 'intermediate', '🔴': 'advanced' })[q.n] ?? null,
    question: q.q, alternatives: q.a, correctIndex: q.c, explanation: q.e,
    sourceTopic: `${topic.domain}/${String(topic.order).padStart(2, '0')}`, source: q.source,
  })) } : topic;
  const errors = schemaErrors(validateCanonical, candidate);
  if (!topic || typeof topic !== 'object' || !topic.id || !Number.isInteger(topic.order) || !topic.domain || !topic.title) {
    errors.push({ code: 'TOPIC_REQUIRED', message: 'id/order/domain/title obrigatórios', path: '/' });
  }
  if (!topic?.metadata?.verification?.reason) errors.push({ code: 'VERIFICATION_DEFAULT', message: 'verification.reason é obrigatório', path: '/metadata/verification/reason' });
  if (!topic || typeof topic !== 'object' || Array.isArray(topic)) return { valid: false, errors };
  const raw = typeof topic.rawMarkdown === 'string' ? topic.rawMarkdown : '';
  let cursor = 0;
  for (const [index, part] of (Array.isArray(topic.partitions) ? topic.partitions : []).entries()) {
    const span = part?.source;
    if (!span || span.start !== cursor || span.end < span.start || span.end > raw.length || raw.slice(span.start, span.end) !== part.markdown) {
      errors.push({ code: 'PARTITION_LOSS', message: `Partição ${index} deve cobrir fonte sem lacunas e reconstruir rawMarkdown`, path: `/partitions/${index}` });
    }
    if (Number.isInteger(span?.end)) cursor = span.end;
  }
  if (cursor !== raw.length) errors.push({ code: 'PARTITION_COVERAGE', message: 'Partições não cobrem todo rawMarkdown', path: '/partitions' });

  for (const [key, items] of [['sections', topic.sections], ['interviewQuestions', topic.interviewQuestions]]) {
    for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
      const ref = item?.source, span = ref?.span;
      if (!ref || ref.path !== topic.source?.path || ref.sha256 !== topic.source?.sha256 || !Number.isInteger(span?.start) || !Number.isInteger(span?.end) || span.start < 0 || span.end < span.start || span.end > raw.length) {
        errors.push({ code: 'SOURCE_SPAN', message: 'Referência de fonte/hash/span inconsistente com o tópico', path: `/${key}/${index}/source` });
      } else if (key === 'sections' && raw.slice(span.start, span.end) !== item.markdown) {
        errors.push({ code: 'SOURCE_SPAN_CONTENT', message: 'Markdown da seção não corresponde ao span da fonte', path: `/${key}/${index}/markdown` });
      }
    }
  }

  const ids = new Set();
  for (const [key, collection] of [['interviewQuestions', topic.interviewQuestions], ['quizQuestions', topic.quizQuestions]]) {
    for (const [index, item] of (Array.isArray(collection) ? collection : []).entries()) {
      if (typeof item?.id === 'string') {
        if (ids.has(item.id)) errors.push({ code: 'DUPLICATE_ID', message: `ID repetido ${item.id}`, path: `/${key}/${index}/id` });
        ids.add(item.id);
      }
    }
  }
  for (const [index, section] of (Array.isArray(topic.sections) ? topic.sections : []).entries()) {
    if (typeof section?.id === 'string') {
      if (ids.has(section.id)) errors.push({ code: 'DUPLICATE_ID', message: `ID repetido ${section.id}`, path: `/sections/${index}/id` });
      ids.add(section.id);
    }
  }
  for (const [index, q] of (Array.isArray(topic.quizQuestions) ? topic.quizQuestions : []).entries()) {
    if (Number.isInteger(q?.correctIndex) && Array.isArray(q?.alternatives) && (q.correctIndex < 0 || q.correctIndex >= q.alternatives.length)) {
      errors.push({ code: 'QUIZ_CORRECT_INDEX', message: 'correctIndex fora da faixa das alternativas', path: `/quizQuestions/${index}/correctIndex` });
    }
    if (q?.sourceTopic !== `${topic.domain}/${String(topic.order).padStart(2, '0')}` || q?.source?.path !== `${topic.domain}/quiz.json`) {
      errors.push({ code: 'QUIZ_FOREIGN_REFERENCE', message: 'Questão de quiz não pertence ao tópico', path: `/quizQuestions/${index}/sourceTopic` });
    }
  }
  const canonicalRefs = new Set();
  for (const [index, q] of (Array.isArray(topic.quizQuestions) ? topic.quizQuestions : []).entries()) {
    const ref = `${q?.source?.path}${q?.source?.pointer}`;
    if (canonicalRefs.has(ref)) errors.push({ code: 'DUPLICATE_QUIZ_REF', message: `Referência duplicada ${ref}`, path: `/quizQuestions/${index}/source/pointer` });
    canonicalRefs.add(ref);
  }
  if (legacyQuiz) {
    const references = new Set();
    for (const q of topic.quizQuestions) {
      const ref = `${q?.source?.path}${q?.pointer}`;
      if (references.has(ref)) errors.push({ code: 'DUPLICATE_QUIZ_REF', message: `Referência duplicada ${ref}`, path: '/quizQuestions' });
      references.add(ref);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Validate source quiz bank and return Ajv diagnostics without throwing on malformed roots. */
export function validateQuiz(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (error) { return { valid: false, errors: [{ code: 'JSON_INVALID', message: error.message, path: '/' }] }; }
  const errors = schemaErrors(validateQuizBank, data);
  for (const [theme, items] of Object.entries(data && typeof data === 'object' && !Array.isArray(data) ? data : {})) {
    if (Array.isArray(items)) items.forEach((q, index) => {
      if (Array.isArray(q?.a) && Number.isInteger(q?.c) && (q.c < 0 || q.c >= q.a.length)) errors.push({ code: 'QUIZ_CORRECT_INDEX', message: 'c fora da faixa das alternativas', path: `/${theme}/${index}/c` });
    });
  }
  return { valid: errors.length === 0, errors };
}
