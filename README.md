# Codex Memory Sidecar

Local MCP memory sidecar for Codex app.

The sidecar provides explicit tools for long-term working memory:

- `search_memory`
- `write_memory`
- `update_memory`
- `forget_memory`
- `consolidate_memory`
- `memory_digest`

Memory is stored locally in SQLite. Keyword search uses SQLite FTS. If Ollama is running, writes and searches also use local embeddings for hybrid retrieval. If Ollama is unavailable, tools continue with keyword search and return a warning.

## Setup

Install dependencies:

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
```

Build:

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
```

Run tests:

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
```

## Configuration

Create `config/memory-sidecar.toml` if you want to override defaults:

```toml
ollama_base_url = "http://localhost:11434"
embedding_model = "embeddinggemma"
maintenance_model = "qwen3"
database_path = "data/memory.sqlite"
default_search_limit = 8
consolidation_dry_run = true
```

Environment variable overrides:

- `CODEX_MEMORY_DB`
- `OLLAMA_BASE_URL`
- `CODEX_MEMORY_EMBEDDING_MODEL`
- `CODEX_MEMORY_MAINTENANCE_MODEL`
- `CODEX_MEMORY_DEFAULT_SEARCH_LIMIT`
- `CODEX_MEMORY_CONSOLIDATION_DRY_RUN`

## Codex MCP Registration

After building, register the stdio server with Codex using:

```text
node C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\dist\index.js
```

The default database path is:

```text
C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\data\memory.sqlite
```

## Ollama

Expected local endpoint:

```text
http://localhost:11434
```

Recommended first embedding model:

```powershell
ollama pull embeddinggemma
```

The sidecar uses Ollama only as a local memory librarian for embeddings. Codex remains responsible for final reasoning.
