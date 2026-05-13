export type MemoryLayer = "core" | "recall" | "archival";
export type MemoryStatus = "active" | "superseded" | "forgotten";
export type MemoryEventType = "created" | "updated" | "forgotten" | "consolidated" | "retrieved";

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
