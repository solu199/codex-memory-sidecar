export type ViewId =
  | "observatory"
  | "health"
  | "memories"
  | "directives"
  | "maintenance"
  | "events"
  | "settings";

export type DashboardStatus = {
  ok: boolean;
  checkedAt: string;
  dashboard: {
    schemaVersion: string;
    buildFingerprint: string;
  };
  database: {
    ok: boolean;
    memoryCount: number;
    eventCount: number;
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
  };
  memoryStats: {
    byStatus: Record<string, number>;
    byLayer: Record<string, number>;
    byProjectScope: ProjectScopeStat[];
    updatedAtRange: {
      oldest: string | null;
      newest: string | null;
    };
  };
  maintenance: {
    repairRecommended: boolean;
    latestBackup: BackupStat | null;
    backupRetention: {
      backupDir: string;
      keepCount: number;
      backupCount: number;
      keptCount: number;
      prunableCount: number;
      prunableSizeBytes: number;
      latestBackup: BackupStat | null;
      prunable: BackupStat[];
    };
  };
  embedding: {
    ok: boolean;
    dimensions: number;
    error: string | null;
    required: boolean;
  };
  ollama: {
    ok: boolean;
    required: boolean;
    baseUrl: string;
    embeddingModel: string;
    maintenanceModel: string;
    embeddingModelAvailable: boolean;
    maintenanceModelAvailable: boolean;
    modelNames: string[];
    error: string | null;
  } | null;
  directives: DirectiveMemory[];
  disabledDirectives: DirectiveMemory[];
  recentMemories: RecentMemory[];
  recentEvents: RecentEvent[];
  memoryFreshness: {
    status: string;
    latestMemoryUpdatedAt: string | null;
    latestWorkspaceActivityAt: string | null;
    daysSinceLatestMemoryUpdate: number | null;
    daysBehindWorkspaceActivity: number | null;
    candidateCount: number;
    message: string;
    recommendedAction: string;
  };
  memoryUpdateCandidates: MemoryUpdateCandidate[];
  autoMemoryCuration: {
    mode: string;
    threshold: number;
    evaluatedAt: string;
    evaluatedCount: number;
    reviewCount: number;
    autoWriteEligibleCount: number;
    skippedCount: number;
    note: string;
  };
  warnings: string[];
  warningActions: WarningAction[];
};

export type ProjectScopeStat = {
  projectScope: string;
  total: number;
  active: number;
  latestUpdatedAt: string | null;
};

export type BackupStat = {
  backupPath: string;
  sizeBytes: number;
  mtime: string;
};

export type DirectiveMemory = {
  id: number;
  scope: string;
  projectScope: string;
  content: string;
  rationale: string;
  tags: string[];
  sourceType: string;
  sourceRef: string;
  priority: number;
  status: string;
  updatedAt: string;
};

export type RecentMemory = {
  id: number;
  layer: string;
  summary: string;
  tags: string[];
  projectScope: string;
  sourceType: string;
  sourceRef: string;
  importance: number;
  confidence: number;
  status: string;
  updatedAt: string;
};

export type RecentEvent = {
  id: number;
  memoryId: number;
  eventType: string;
  createdAt: string;
};

export type MemoryUpdateCandidate = {
  kind: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceRef: string;
  occurredAt: string;
  reason: string;
  suggestedTool: string;
};

export type WarningAction = {
  severity: "warning" | "error";
  title: string;
  message: string;
  action: string;
  tools: string[];
};

export type MemoryDetail = {
  id: number;
  layer: string;
  summary: string;
  tags: string[];
  projectScope: string;
  sourceType: string;
  sourceRef: string;
  sourceUrl: string | null;
  importance: number;
  confidence: number;
  status: string;
  contentAvailable: boolean;
  contentIncluded: boolean;
  content?: string;
  createdAt: string;
  updatedAt: string;
  validFrom: string;
  invalidatedAt: string | null;
  invalidatedByRef: string | null;
  invalidationReason: string | null;
  lastAccessedAt: string | null;
  expiresAt: string | null;
};

export type MemoryGraph = {
  nodes: GraphNode[];
  edges: {
    similarity: GraphEdge[];
    hebbian: GraphEdge[];
  };
  events: GraphEvent[];
  clusters?: Array<{
    key: string;
    label: string;
    color?: string;
  }>;
  privacy?: Record<string, boolean>;
};

export type GraphNode = {
  id: number;
  layer: string;
  status: string;
  summary: string;
  tags: string[];
  projectScope: string;
  sourceType: string;
  sourceRef: string;
  importance: number;
  confidence: number;
  activation?: number;
  retrievability7d?: number;
  updatedAt?: string;
  createdAt?: string;
};

export type GraphEdge = {
  source: number;
  target: number;
  weight: number;
  latestAt?: string;
};

export type GraphEvent = {
  eventType: string;
  memoryIds: number[];
  createdAt: string;
};
