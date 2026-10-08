import type { Difficulty, SourceRef, StudyTopic } from '../types.js';

export type RecallKind =
  | 'recall' | 'application' | 'conceptual' | 'comparison' | 'find-error' | 'scenario';
export type LessonEvidence = SourceRef | { path: string; sha256: string; pointer: string };
export interface Derivation { type: 'extract' | 'authored'; rationale?: string }
export interface LessonContent {
  markdown: string;
  plainText: string;
  sourceRef: LessonEvidence;
  derivation: Derivation;
}
export interface ActiveRecallQuestion {
  id: string;
  kind: RecallKind;
  difficulty: Difficulty;
  question: string;
  answer: string | null;
  explanation: string;
  sourceRef: LessonEvidence;
  derivation?: Derivation;
  followUps: Array<{ question: string; answer: string | null; sourceRef: SourceRef }>;
}
export interface StudyLesson {
  id: string;
  schemaVersion: 1;
  domain: string;
  sourceTopic: string;
  difficulty: 'basic' | 'intermediate' | 'advanced' | 'mixed';
  title: string;
  source: { path: string; sha256: string };
  verificationStatus: 'unverified' | 'verified' | 'needs-review' | 'conflicting';
  objectives: LessonContent[];
  summary: LessonContent;
  concepts: Array<LessonContent & { id: string; title: string }>;
  examples: LessonContent[];
  questions: ActiveRecallQuestion[];
  pitfalls: LessonContent[];
  recap: LessonContent[];
  sources: Array<{ path: string; sha256: string }>;
  externalSources?: ExternalAuditSource[];
  audit?: AuditLessonMetadata;
}
export interface ExternalAuditSource {
  type: 'official-doc' | 'spec' | 'original-paper' | 'vendor' | 'canonical-book' | 'secondary';
  url: string;
  title: string;
  checkedAt: string;
  locator: string;
  version?: string;
  sourceHash: string;
  logicalSnapshotHash: string;
  logicalSnapshotHashMatches: true;
  claimIds: string[];
  verifiedClaimIds: string[];
  claimStatuses: Array<'VERIFIED' | 'NEEDS_SOURCE' | 'NEEDS_REVIEW' | 'OUTDATED' | 'CONFLICTING'>;
}
export interface AuditLessonMetadata {
  coverage?: Record<string, unknown>;
  counts?: Record<string, number>;
  bindingStatus: 'bound' | 'stale' | 'invalid' | 'missing';
  warning?: string;
}

export function buildLesson(topic: StudyTopic, auditReport?: unknown): StudyLesson;
export function validateLesson(lesson: unknown, topic?: StudyTopic): {
  valid: boolean;
  errors: Array<{ message: string; instancePath?: string }>;
};
export function serialiseLesson(lesson: StudyLesson): string;
