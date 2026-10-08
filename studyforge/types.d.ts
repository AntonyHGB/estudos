export type Difficulty = 'basic' | 'intermediate' | 'advanced' | null;
export type SourceSpan = {start:number;end:number;startLine:number;endLine:number};
export type FileSource = {path:string;sha256:string};
export type SourceRef = FileSource & {span:SourceSpan;anchor:string};
export interface StudySection {id:string;level:2;title:string;markdown:string;plainText:string;source:SourceRef}
export interface FollowUp {question:string;answer:string|null;source:SourceSpan}
export interface InterviewQuestion {id:string;kind:'question'|'scenario'|'case-study'|'calibration';difficulty:Difficulty;difficultyReason:string|null;question:string;modelAnswer:string|null;followUps:FollowUp[];traps:string[];sourceAnchor:string;source:SourceRef}
export interface QuizQuestion {id:string;theme:string;index:number;difficulty:'basic'|'intermediate'|'advanced'|null;question:string;alternatives:string[];correctIndex:number;explanation:string;sourceTopic:string;source:FileSource&{pointer:string}}
export interface ParsedQuizQuestion {id:string;theme:string;index:number;n:'🟢'|'🟡'|'🔴';q:string;a:string[];c:number;e:string;pointer:string;source:FileSource&{pointer:string}}
export interface MarkdownPartition {kind:'blank'|'heading'|'list'|'table'|'blockquote'|'question-or-emphasis'|'paragraph'|'code';markdown:string;plainText:string;source:SourceSpan}
export interface StudyTopic {schemaVersion:1;id:string;order:number;domain:'engenharia-de-dados'|'machine-learning';title:string;subtitle:string|null;source:FileSource;rawMarkdown:string;partitions:MarkdownPartition[];sections:StudySection[];interviewQuestions:InterviewQuestion[];quizQuestions:QuizQuestion[];metadata:{verification:{status:'unverified'|'verified'|'needs-review'|'conflicting';reason:string}}}
export interface ValidationError {code:string;message:string;path?:string;source?:string}
export function validateTopic(topic: unknown): {valid:boolean;errors:ValidationError[]};
export function validateQuiz(raw: unknown): {valid:boolean;errors:ValidationError[]};
export function normalizeQuizQuestion(question: ParsedQuizQuestion, topic: Pick<StudyTopic,'domain'|'order'>): QuizQuestion;
export const DOMAINS: readonly ['engenharia-de-dados','machine-learning'];
export function discoverTopics(root?:string): Promise<Array<{domain:string;path:string;relativePath:string;order:number}>>;
export function compileAll(root?:string): Promise<{topics:StudyTopic[];warnings:unknown[];errors:ValidationError[]}>;
export function selectTopics(topics:StudyTopic[], selector:string): StudyTopic[];
