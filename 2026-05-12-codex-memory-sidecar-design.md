# Codex Memory Sidecar Design

> Note: This is the initial design note from 2026-05-12. It is kept as historical context and may not match the current implementation exactly.
> For current setup and daily operation, prefer `README.md`, `docs/daily-operations.md`, and `AGENTS-memory-protocol.md`.

## Purpose

Build a local MCP-based memory sidecar for Codex app. The sidecar lets Codex search, write, update, forget, and consolidate long-term working memory without modifying Codex app internals.

The goal is to make past project knowledge, user preferences, decisions, and work history available at inference time through explicit tools. Memory should remain local-first, inspectable, and reversible.

## Recommended Project Location

Create the actual project as a stable local tool repo, separate from temporary Codex task folders:

```text
C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar
```

This location is preferable to a date-scoped workspace such as:

```text
C:\Users\hare1\Documents\Codex\2026-05-12\codex-rag-ai
```

Date-scoped folders are good for experiments and design notes, but the sidecar should become durable infrastructure used across many Codex sessions. A stable `tools` folder also makes MCP configuration paths, model settings, SQLite storage paths, logs, and backups easier to maintain.

## Architecture

The system has four parts:

1. MCP server
2. Local memory store
3. Ollama-backed model worker
4. Maintenance and audit layer

```text
Codex app
  -> MCP tools
       search_memory
       write_memory
       update_memory
       forget_memory
       consolidate_memory
       memory_digest
  -> codex-memory-sidecar
       SQLite metadata store
       SQLite FTS keyword index
       vector embeddings via Ollama
       consolidation worker via Ollama
       audit log
```

Codex talks only to the MCP tools. The sidecar owns persistence, retrieval, embedding generation, memory cleanup, and model calls to Ollama.

## Memory Layers

### Core Memory

Short, high-value memory that should often be visible to Codex. Examples:

- User preferences
- Stable coding style choices
- Important safety constraints
- Active long-term goals
- Frequently reused project assumptions

Core memory should be compact and curated. It is not a transcript store.

### Recall Memory

Searchable memory of prior work. Examples:

- Past task summaries
- Bugs fixed before
- commands that worked or failed
- project-specific decisions
- useful conversation outcomes

Recall memory is optimized for search and chronological traceability.

### Archival Memory

Long-term knowledge that may be useful across projects or after long gaps. Examples:

- durable technical notes
- design patterns the user prefers
- reusable local setup knowledge
- recurring lessons from previous Codex sessions

Archival memory can be larger than core memory, but still should be summarized and deduplicated.

## Storage Design

Use SQLite as the primary local store. Prefer a single database file at first:

```text
data/memory.sqlite
```

Suggested tables:

```text
memories
- id
- layer: core | recall | archival
- content
- summary
- tags
- source_type
- source_ref
- importance
- confidence
- created_at
- updated_at
- last_accessed_at
- expires_at
- status: active | superseded | forgotten

memory_relations
- id
- source_memory_id
- target_memory_id
- relation_type: supersedes | duplicates | contradicts | supports | derives_from
- note
- created_at

memory_events
- id
- memory_id
- event_type: created | updated | forgotten | consolidated | retrieved
- payload_json
- created_at
```

Use SQLite FTS for keyword search. Store embeddings either in SQLite as JSON or binary blobs for the first version. If vector search becomes a bottleneck, introduce a dedicated vector store later.

## Ollama Integration

Ollama is assumed to run locally at:

```text
http://localhost:11434
```

Use Ollama for two separate jobs:

1. Embeddings for retrieval
2. Small-model reasoning for memory maintenance

Recommended embedding candidates:

- `embeddinggemma`
- `qwen3-embedding`
- `all-minilm`

Recommended maintenance model candidates:

- `qwen3`
- `gemma3`

Use structured outputs for memory extraction and consolidation. Temperature should be low for deterministic maintenance tasks.

The small model should not be responsible for final Codex reasoning. It should act as a memory librarian:

- extract memory candidates
- normalize content
- generate tags
- detect duplicates
- identify contradictions
- summarize old memories
- propose consolidation changes
- expand search queries

## MCP Tools

### search_memory

Searches local memory using hybrid retrieval.

Inputs:

- query
- layers
- tags
- limit
- include_superseded

Output:

- ranked memories
- summaries
- source references
- relevance scores
- timestamps

### write_memory

Creates a new memory.

Inputs:

- content
- layer
- tags
- source_type
- source_ref
- importance
- confidence

Output:

- created memory
- duplicate candidates
- suggested relation links

### update_memory

Updates an existing memory while preserving history.

Inputs:

- memory_id
- new_content
- update_note

Output:

- updated memory
- event record

### forget_memory

Marks a memory as forgotten. This should be a logical delete by default.

Inputs:

- memory_id
- reason
- hard_delete optional, default false

Output:

- forgotten memory record
- audit event

### consolidate_memory

Finds stale, duplicate, contradictory, or overlong memory and proposes changes.

Inputs:

- layers
- since
- dry_run default true
- max_candidates

Output:

- proposed merges
- proposed summaries
- proposed forgotten records
- contradiction warnings

The first implementation should default to dry-run. Automatic application can be added later.

### memory_digest

Builds a compact context digest for Codex before work begins.

Inputs:

- task_description
- project_path
- max_tokens

Output:

- compact memory summary
- top relevant memories
- warnings about stale or conflicting memory

## Retrieval Flow

Search should combine:

1. keyword search through SQLite FTS
2. vector similarity through Ollama embeddings
3. metadata filters such as layer, tags, project path, and recency
4. reranking based on importance, confidence, freshness, and source quality

For a first version, use a simple weighted score:

```text
score =
  vector_similarity * 0.45
  + keyword_score * 0.30
  + importance * 0.15
  + freshness * 0.10
```

Tune after real use.

## Memory Maintenance Flow

When Codex or the user asks to store information:

1. normalize the candidate memory
2. generate embedding
3. search for similar memories
4. return duplicate or contradiction candidates
5. save only after explicit `write_memory` or `update_memory`

When consolidation runs:

1. find stale or similar memories
2. ask Ollama for structured consolidation proposals
3. return proposals to Codex
4. apply only when explicitly requested

This avoids early over-automation.

## Safety and Privacy

All memory stays local by default.

Important safeguards:

- logical delete before hard delete
- audit log for writes, updates, forgets, and consolidations
- memory source references
- confidence and importance fields
- dry-run consolidation by default
- no automatic storage of secrets
- configurable excluded paths and patterns

The sidecar should refuse to store likely secrets unless explicitly overridden.

## Configuration

Use a config file such as:

```text
config/memory-sidecar.toml
```

Suggested settings:

```text
ollama_base_url = "http://localhost:11434"
embedding_model = "embeddinggemma"
maintenance_model = "qwen3"
database_path = "data/memory.sqlite"
default_search_limit = 8
consolidation_dry_run = true
```

## Testing

Testing should cover:

- database migrations
- memory creation and update
- logical forgetting
- FTS search
- embedding fallback behavior when Ollama is unavailable
- hybrid ranking
- consolidation dry-run behavior
- MCP tool schemas
- refusal to store obvious secrets

Ollama-dependent tests should be separable from fast unit tests.

## Phased Implementation

### Phase 1: Local MCP Skeleton

- Create project scaffold
- Add MCP server
- Define tool schemas
- Add SQLite database and migrations
- Implement basic CRUD tools

### Phase 2: Search

- Add FTS keyword search
- Add Ollama embeddings
- Add hybrid retrieval
- Implement `memory_digest`

### Phase 3: Maintenance Worker

- Add structured Ollama prompts
- Implement duplicate detection
- Implement consolidation dry-run
- Add audit events

### Phase 4: Codex Integration

- Register MCP server with Codex app
- Test search and write flows from Codex
- Add stable local config
- Document operating workflow

## Implementation Defaults

Use these defaults for the first implementation:

- Language: TypeScript
- Runtime: Node.js
- MCP SDK: official TypeScript MCP SDK
- Database: SQLite
- Keyword search: SQLite FTS
- Embedding storage: JSON text column in SQLite for version 1
- Vector database: none for version 1
- Embedding model: `embeddinggemma`
- Maintenance model: `qwen3`
- Automatic memory writes: disabled
- Consolidation: dry-run by default

These choices keep the sidecar easy to run from Codex MCP configuration while avoiding extra infrastructure. A dedicated vector database can be introduced later if SQLite-based vector scoring becomes too slow.
