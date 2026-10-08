/** Canonical StudyForge contract. Versioned independently of all renderers. */
export const MODEL_VERSION = 1;
export const VERIFICATION_STATUS = 'unverified';
export const DOMAINS = Object.freeze(['engenharia-de-dados', 'machine-learning']);

/** Convert parser's legacy n/q/a/c/e quiz record to the public canonical model. */
export function normalizeQuizQuestion(question, topic) {
  const difficulty = ({ '🟢': 'basic', '🟡': 'intermediate', '🔴': 'advanced' })[question.n] ?? null;
  return {
    id: question.id, theme: question.theme, index: question.index,
    difficulty, question: question.q, alternatives: [...question.a],
    correctIndex: question.c, explanation: question.e,
    sourceTopic: `${topic.domain}/${String(topic.order).padStart(2, '0')}`,
    source: { ...question.source },
  };
}

/**
 * @typedef {{start:number,end:number,startLine:number,endLine:number}} SourceSpan
 * @typedef {{path:string,sha256:string,span:SourceSpan,anchor:string}} SourceRef
 * @typedef {{id:string,level:number,title:string,markdown:string,plainText:string,source:SourceRef}} StudySection
 * @typedef {{question:string,answer?:string|null,source:SourceSpan}} FollowUp
 * @typedef {{id:string,kind:'question'|'scenario'|'case-study'|'calibration',difficulty:'basic'|'intermediate'|'advanced'|null,difficultyReason?:string|null,question:string,modelAnswer:string|null,followUps:FollowUp[],traps:string[],sourceAnchor:string,source:SourceRef}} InterviewQuestion
 * @typedef {{id:string,theme:string,index:number,n:string,q:string,a:string[],c:number,e:string,pointer:string,source:{path:string,sha256:string,pointer:string}}} QuizQuestion
 * @typedef {{id:string,order:number,domain:string,title:string,subtitle:string|null,source:{path:string,sha256:string},rawMarkdown:string,sections:StudySection[],interviewQuestions:InterviewQuestion[],quizQuestions:QuizQuestion[],metadata:{verification:{status:'unverified',reason:string}}}} StudyTopic
 */
