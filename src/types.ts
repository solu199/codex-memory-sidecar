export type MemoryLayer = "core" | "recall" | "archival";
export type MemoryStatus = "active" | "superseded" | "forgotten";
export type MemoryEventType = "created" | "updated" | "forgotten" | "consolidated" | "retrieved";

export interface Memory {
  id: number;
  layer: MemoryLayer;
  content: string;
  summary: string;
  tags: string[];
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
}

export interface UpdateMemoryInput {
  memoryId: number;
  newContent: string;
  updateNote: string;
  tags?: string[];
  summary?: string;
  allowSecret?: boolean;
}

export interface ForgetMemoryInput {
  memoryId: number;
  reason: string;
  hardDelete?: boolean;
}

export interface SearchMemoryInput {
  query: string;
  queryEmbedding?: number[] | null;
  layers?: MemoryLayer[];
  tags?: string[];
  limit?: number;
  includeSuperseded?: boolean;
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
