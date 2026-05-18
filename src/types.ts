export type MemoryLayer = "core" | "recall" | "archival";
export type MemoryStatus = "active" | "superseded" | "forgotten";
export type MemoryEventType = "created" | "updated" | "forgotten" | "consolidated" | "retrieved";
export type DirectiveScope = "global" | "project";
export type DirectiveStatus = "active" | "disabled" | "superseded";
export type DirectiveEventType = "created" | "updated" | "disabled" | "retrieved";

export interface Memory {
  id: number;
  layer: MemoryLayer;
  content: string;
  summary: string;
  tags: string[];
  projectScope: string;
  sourceType: string;
  sourceRef: string;
  importance: number;
  confidence: number;
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
  status: MemoryStatus;
}

export interface MemoryEvent {
  id: number;
  memoryId: number;
  eventType: MemoryEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface Directive {
  id: number;
  scope: DirectiveScope;
  projectScope: string;
  content: string;
  rationale: string;
  tags: string[];
  sourceType: string;
  sourceRef: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  status: DirectiveStatus;
}

export interface DirectiveEvent {
  id: number;
  directiveId: number;
  eventType: DirectiveEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateDirectiveInput {
  content: string;
  scope: DirectiveScope;
  projectScope?: string;
  projectPath?: string;
  rationale: string;
  tags?: string[];
  sourceType: string;
  sourceRef: string;
  priority?: number;
  allowSecret?: boolean;
}

export interface ListDirectivesInput {
  projectScope?: string;
  projectPath?: string;
  includeGlobal?: boolean;
  includeProject?: boolean;
  includeDisabled?: boolean;
  limit?: number;
}

export interface DisableDirectiveInput {
  directiveId: number;
  reason: string;
}

export interface CreateMemoryInput {
  content: string;
  layer: MemoryLayer;
  tags?: string[];
  sourceType: string;
  sourceRef: string;
  importance?: number;
  confidence?: number;
  embedding?: number[] | null;
  summary?: string;
  expiresAt?: Date | null;
  allowSecret?: boolean;
  projectScope?: string;
  projectPath?: string;
}

export interface UpdateMemoryInput {
  memoryId: number;
  newContent: string;
  updateNote: string;
  tags?: string[];
  summary?: string;
  embedding?: number[] | null;
  allowSecret?: boolean;
}

export interface ForgetMemoryInput {
  memoryId: number;
  reason: string;
  hardDelete?: boolean;
  confirmHardDelete?: boolean;
}

export interface SearchMemoryInput {
  query: string;
  queryEmbedding?: number[] | null;
  layers?: MemoryLayer[];
  tags?: string[];
  limit?: number;
  includeSuperseded?: boolean;
  hybridCandidateLimit?: number;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
}

export interface SearchMemoryResult {
  memory: Memory;
  score: number;
  scoreBreakdown: {
    vector: number;
    keyword: number;
    importance: number;
    freshness: number;
  };
}

export interface CreateBackupInput {
  backupPath?: string;
}

export interface MemoryBackup {
  backupPath: string;
  createdAt: Date;
}

export interface BackupRetentionPlanInput {
  keepCount?: number;
}

export interface BackupRetentionPlanEntry {
  backupPath: string;
  sizeBytes: number;
  mtime: Date;
}

export interface BackupRetentionPlan {
  backupDir: string;
  keepCount: number;
  backups: BackupRetentionPlanEntry[];
  kept: BackupRetentionPlanEntry[];
  prunable: BackupRetentionPlanEntry[];
  plannedAt: Date;
}

export interface VerifyBackupInput {
  backupPath: string;
}

export interface BackupVerification {
  backupPath: string;
  ok: boolean;
  memoryCount: number;
  eventCount: number;
  integrityCheck: string;
  schemaOk: boolean;
  warnings: string[];
  checkedAt: Date;
}

export interface BackupMemorySummary {
  id: number;
  layer: MemoryLayer;
  summary: string;
  tags: string[];
  projectScope: string;
  sourceType: string;
  sourceRef: string;
  importance: number;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
  status: MemoryStatus;
}

export interface InspectBackupInput {
  backupPath: string;
  layers?: MemoryLayer[];
  includeSuperseded?: boolean;
  includeForgotten?: boolean;
  limit?: number;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
}

export interface BackupInspection extends BackupVerification {
  memories: BackupMemorySummary[];
}

export interface RepairMemoryIndexInput {
  backupPath?: string;
  createBackup?: boolean;
}

export interface MemoryIndexRepair {
  repaired: boolean;
  backupPath: string | null;
  backupVerification: BackupVerification | null;
  before: DatabaseHealth;
  after: DatabaseHealth;
  warnings: string[];
  repairedAt: Date;
}

export interface MemoryStoreCounts {
  memoryCount: number;
  eventCount: number;
}

export interface DatabaseHealth {
  ok: boolean;
  integrityCheck: string;
  fts: {
    ok: boolean;
    expectedCount: number;
    indexedCount: number;
    missingCount: number;
    orphanCount: number;
  };
  walCheckpoint: {
    busy: number;
    log: number;
    checkpointed: number;
  };
  warnings: string[];
  checkedAt: Date;
}

export interface MemoryStats extends MemoryStoreCounts {
  byStatus: Record<MemoryStatus, number>;
  byLayer: Record<MemoryLayer, number>;
  byProjectScope: Array<{
    projectScope: string;
    total: number;
    active: number;
    latestUpdatedAt: Date | null;
  }>;
  updatedAtRange: {
    oldest: Date | null;
    newest: Date | null;
  };
}

export interface ListRecentEventsInput {
  limit?: number;
  memoryId?: number;
}

export interface ListMemoriesInput {
  layers?: MemoryLayer[];
  includeSuperseded?: boolean;
  includeForgotten?: boolean;
  since?: string;
  limit?: number;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
}
