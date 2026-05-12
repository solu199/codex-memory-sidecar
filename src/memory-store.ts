import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { cosineSimilarity } from "./embedding.js";
import { containsLikelySecret } from "./secret-detection.js";
import type {
  CreateMemoryInput,
  CreateBackupInput,
  ForgetMemoryInput,
  ListRecentEventsInput,
  Memory,
  MemoryBackup,
  MemoryEvent,
  MemoryEventType,
  MemoryLayer,
  SearchMemoryInput,
  SearchMemoryResult,
  UpdateMemoryInput
} from "./types.js";

interface MemoryRow {
  id: number;
  layer: MemoryLayer;
  content: string;
  summary: string;
  tags: string;
  source_type: string;
  source_ref: string;
  importance: number;
  confidence: number;
  embedding: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  expires_at: string | null;
  status: Memory["status"];
}

interface EventRow {
  id: number;
  memory_id: number;
  event_type: MemoryEventType;
  payload_json: string;
  created_at: string;
}

export class MemoryStore {
  private readonly db: Database.Database;
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createMemory(input: CreateMemoryInput): Memory {
    this.assertStorable(input.content, input.allowSecret);

    const now = new Date();
    const result = this.db
      .prepare(
        `INSERT INTO memories (
          layer, content, summary, tags, source_type, source_ref,
          importance, confidence, embedding, created_at, updated_at, expires_at, status
        ) VALUES (
          @layer, @content, @summary, @tags, @sourceType, @sourceRef,
          @importance, @confidence, @embedding, @createdAt, @updatedAt, @expiresAt, 'active'
        )`
      )
      .run({
        layer: input.layer,
        content: input.content,
        summary: input.summary ?? summarize(input.content),
        tags: JSON.stringify(input.tags ?? []),
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        importance: clampScore(input.importance ?? 0.5),
        confidence: clampScore(input.confidence ?? 0.5),
        embedding: input.embedding ? JSON.stringify(input.embedding) : null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: input.expiresAt?.toISOString() ?? null
      });

    const memory = this.getMemory(Number(result.lastInsertRowid));
    if (!memory) {
      throw new Error("Failed to read created memory.");
    }

    this.indexMemory(memory);
    this.recordEvent(memory.id, "created", { input: redactedInput(input) });
    return memory;
  }

  getMemory(memoryId: number): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId) as MemoryRow | undefined;
    return row ? mapMemory(row) : null;
  }

  updateMemory(input: UpdateMemoryInput): Memory {
    this.assertStorable(input.newContent, input.allowSecret);
    const existing = this.requireMemory(input.memoryId);
    const now = new Date();

    this.db
      .prepare(
        `UPDATE memories
         SET content = @content,
             summary = @summary,
             tags = @tags,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: input.memoryId,
        content: input.newContent,
        summary: input.summary ?? summarize(input.newContent),
        tags: JSON.stringify(input.tags ?? existing.tags),
        updatedAt: now.toISOString()
      });

    const updated = this.requireMemory(input.memoryId);
    this.indexMemory(updated);
    this.recordEvent(updated.id, "updated", {
      updateNote: input.updateNote,
      previousSummary: existing.summary
    });
    return updated;
  }

  forgetMemory(input: ForgetMemoryInput): Memory {
    const existing = this.requireMemory(input.memoryId);

    if (input.hardDelete) {
      if (!input.confirmHardDelete) {
        throw new Error("Hard delete requires confirmHardDelete=true.");
      }
      this.deleteFtsRow(input.memoryId);
      this.db.prepare("DELETE FROM memories WHERE id = ?").run(input.memoryId);
      this.recordEvent(input.memoryId, "forgotten", {
        reason: input.reason,
        hardDelete: true,
        previousStatus: existing.status
      });
      return { ...existing, status: "forgotten" };
    }

    this.db
      .prepare("UPDATE memories SET status = 'forgotten', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), input.memoryId);
    this.deleteFtsRow(input.memoryId);
    this.recordEvent(input.memoryId, "forgotten", {
      reason: input.reason,
      hardDelete: false,
      previousStatus: existing.status
    });
    return this.requireMemory(input.memoryId);
  }

  searchMemory(input: SearchMemoryInput): SearchMemoryResult[] {
    if (input.queryEmbedding?.length) {
      return this.searchMemoryWithEmbedding(input);
    }

    const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
    const clauses = ["memories_fts MATCH @query"];
    const params: Record<string, unknown> = {
      query: quoteFtsQuery(input.query),
      limit
    };

    if (!input.includeSuperseded) {
      clauses.push("m.status = 'active'");
    } else {
      clauses.push("m.status != 'forgotten'");
    }

    if (input.layers?.length) {
      clauses.push(`m.layer IN (${input.layers.map((_, index) => `@layer${index}`).join(", ")})`);
      input.layers.forEach((layer, index) => {
        params[`layer${index}`] = layer;
      });
    }

    const rows = this.db
      .prepare(
        `SELECT m.*, bm25(memories_fts) AS keyword_rank
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE ${clauses.join(" AND ")}
         ORDER BY keyword_rank ASC, m.importance DESC, m.updated_at DESC
         LIMIT @limit`
      )
      .all(params) as (MemoryRow & { keyword_rank: number })[];

    const filtered = input.tags?.length
      ? rows.filter((row) => input.tags?.every((tag) => safeParseTags(row.tags).includes(tag)))
      : rows;

    const results = filtered.map((row) => scoreKeywordRow(row));

    const now = new Date().toISOString();
    const markRetrieved = this.db.prepare("UPDATE memories SET last_accessed_at = ? WHERE id = ?");
    for (const result of results) {
      markRetrieved.run(now, result.memory.id);
      this.recordEvent(result.memory.id, "retrieved", { query: input.query });
    }

    return results;
  }

  listEvents(memoryId: number): MemoryEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_events WHERE memory_id = ? ORDER BY id ASC")
      .all(memoryId) as EventRow[];
    return rows.map(mapEvent);
  }

  listRecentEvents(input: ListRecentEventsInput = {}): MemoryEvent[] {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    if (input.memoryId) {
      const rows = this.db
        .prepare("SELECT * FROM memory_events WHERE memory_id = ? ORDER BY id DESC LIMIT ?")
        .all(input.memoryId, limit) as EventRow[];
      return rows.map(mapEvent);
    }

    const rows = this.db
      .prepare("SELECT * FROM memory_events ORDER BY id DESC LIMIT ?")
      .all(limit) as EventRow[];
    return rows.map(mapEvent);
  }

  async createBackup(input: CreateBackupInput): Promise<MemoryBackup> {
    mkdirSync(path.dirname(input.backupPath), { recursive: true });
    await this.db.backup(input.backupPath);
    return {
      backupPath: input.backupPath,
      createdAt: new Date()
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layer TEXT NOT NULL CHECK (layer IN ('core', 'recall', 'archival')),
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'forgotten'))
      );

      CREATE TABLE IF NOT EXISTS memory_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (
          relation_type IN ('supersedes', 'duplicates', 'contradicts', 'supports', 'derives_from')
        ),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('created', 'updated', 'forgotten', 'consolidated', 'retrieved')
        ),
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        summary,
        tags
      );
    `);
    this.addColumnIfMissing("memories", "embedding", "TEXT");
  }

  private searchMemoryWithEmbedding(input: SearchMemoryInput): SearchMemoryResult[] {
    const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
    const clauses = [input.includeSuperseded ? "status != 'forgotten'" : "status = 'active'"];
    const params: Record<string, unknown> = {};

    if (input.layers?.length) {
      clauses.push(`layer IN (${input.layers.map((_, index) => `@layer${index}`).join(", ")})`);
      input.layers.forEach((layer, index) => {
        params[`layer${index}`] = layer;
      });
    }

    const rows = this.db.prepare(`SELECT * FROM memories WHERE ${clauses.join(" AND ")}`).all(params) as MemoryRow[];
    const filtered = input.tags?.length
      ? rows.filter((row) => input.tags?.every((tag) => safeParseTags(row.tags).includes(tag)))
      : rows;

    const results = filtered
      .map((row) => scoreHybridRow(row, input.query, input.queryEmbedding ?? []))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    const now = new Date().toISOString();
    const markRetrieved = this.db.prepare("UPDATE memories SET last_accessed_at = ? WHERE id = ?");
    for (const result of results) {
      markRetrieved.run(now, result.memory.id);
      this.recordEvent(result.memory.id, "retrieved", { query: input.query, hybrid: true });
    }

    return results;
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private requireMemory(memoryId: number): Memory {
    const memory = this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} was not found.`);
    }
    return memory;
  }

  private assertStorable(content: string, allowSecret = false): void {
    if (!content.trim()) {
      throw new Error("Memory content cannot be empty.");
    }
    if (!allowSecret && containsLikelySecret(content)) {
      throw new Error("Refusing to store likely secret content without explicit override.");
    }
  }

  private indexMemory(memory: Memory): void {
    this.deleteFtsRow(memory.id);
    this.db
      .prepare("INSERT INTO memories_fts(rowid, content, summary, tags) VALUES (?, ?, ?, ?)")
      .run(memory.id, memory.content, memory.summary, memory.tags.join(" "));
  }

  private deleteFtsRow(memoryId: number): void {
    this.db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(memoryId);
  }

  private recordEvent(memoryId: number, eventType: MemoryEventType, payload: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO memory_events (memory_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(memoryId, eventType, JSON.stringify(redactEventPayload(payload)), new Date().toISOString());
  }
}

function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    layer: row.layer,
    content: row.content,
    summary: row.summary,
    tags: safeParseTags(row.tags),
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    importance: row.importance,
    confidence: row.confidence,
    embedding: row.embedding ? parseEmbedding(row.embedding) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    status: row.status
  };
}

function mapEvent(row: EventRow): MemoryEvent {
  return {
    id: row.id,
    memoryId: row.memory_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: new Date(row.created_at)
  };
}

function safeParseTags(tags: string): string[] {
  const parsed = JSON.parse(tags) as unknown;
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
}

function summarize(content: string): string {
  const compact = content.trim().replace(/\s+/g, " ");
  return compact.length <= 180 ? compact : `${compact.slice(0, 177)}...`;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function quoteFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ""))
    .filter(Boolean);
  return terms.length ? terms.map((term) => `"${term}"`).join(" OR ") : '""';
}

function scoreKeywordRow(row: MemoryRow & { keyword_rank: number }): SearchMemoryResult {
  const keywordScore = 1 / (1 + Math.abs(row.keyword_rank));
  const freshnessScore = freshness(row.updated_at);
  return {
    memory: mapMemory(row),
    score: weightedScore({
      vector: 0,
      keyword: keywordScore,
      importance: row.importance,
      freshness: freshnessScore
    }),
    scoreBreakdown: {
      vector: 0,
      keyword: Number(keywordScore.toFixed(4)),
      importance: row.importance,
      freshness: Number(freshnessScore.toFixed(4))
    }
  };
}

function scoreHybridRow(row: MemoryRow, query: string, queryEmbedding: number[]): SearchMemoryResult {
  const memory = mapMemory(row);
  const vectorScore = memory.embedding ? Math.max(0, cosineSimilarity(queryEmbedding, memory.embedding)) : 0;
  const keywordScore = lexicalScore(query, [memory.content, memory.summary, memory.tags.join(" ")].join(" "));
  const freshnessScore = freshness(row.updated_at);

  const scoreBreakdown = {
    vector: Number(vectorScore.toFixed(4)),
    keyword: Number(keywordScore.toFixed(4)),
    importance: row.importance,
    freshness: Number(freshnessScore.toFixed(4))
  };

  return {
    memory,
    score: weightedScore(scoreBreakdown),
    scoreBreakdown
  };
}

function weightedScore(parts: SearchMemoryResult["scoreBreakdown"]): number {
  return Number(
    (parts.vector * 0.45 + parts.keyword * 0.3 + parts.importance * 0.15 + parts.freshness * 0.1).toFixed(4)
  );
}

function freshness(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, 1 - ageMs / thirtyDaysMs);
}

function redactedInput(input: CreateMemoryInput): Record<string, unknown> {
  return {
    layer: input.layer,
    tags: input.tags ?? [],
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    importance: input.importance,
    confidence: input.confidence
  };
}

function parseEmbedding(value: string): number[] | null {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "number") ? parsed : null;
}

function lexicalScore(query: string, text: string): number {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) {
    return 0;
  }

  const normalized = text.toLowerCase();
  const matches = terms.filter((term) => normalized.includes(term)).length;
  return matches / terms.length;
}

function redactEventPayload(value: unknown): unknown {
  if (typeof value === "string") {
    return containsLikelySecret(value) ? "[REDACTED_SECRET]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactEventPayload(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactEventPayload(item)])
    );
  }

  return value;
}
