import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { fetchDashboardStatus, fetchMemoryDetail, fetchMemoryGraph } from "./api";
import { ObservatoryView } from "./ObservatoryView";
import type {
  DashboardStatus,
  DirectiveMemory,
  MemoryDetail,
  MemoryGraph,
  MemoryUpdateCandidate,
  ObservatoryGraphOptions,
  RecentMemory,
  ViewId,
  WarningAction,
} from "./types";

const NAV_ITEMS: Array<{ id: ViewId; label: string }> = [
  { id: "observatory", label: "観測" },
  { id: "health", label: "状態" },
  { id: "memories", label: "メモリ" },
  { id: "directives", label: "Directive" },
  { id: "maintenance", label: "保守" },
  { id: "events", label: "イベント" },
  { id: "settings", label: "設定" },
];

export function App() {
  const [activeView, setActiveView] = useState<ViewId>("observatory");
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [graphOptions, setGraphOptions] = useState<ObservatoryGraphOptions>({
    includeSuperseded: false,
    includeForgotten: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMemoryId, setSelectedMemoryId] = useState<number | null>(null);
  const [memoryDetail, setMemoryDetail] = useState<MemoryDetail | null>(null);
  const [memoryDetailError, setMemoryDetailError] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const [nextStatus, nextGraph] = await Promise.all([
        fetchDashboardStatus(),
        fetchMemoryGraph(graphOptions),
      ]);
      setStatus(nextStatus);
      setGraph(nextGraph);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }, [graphOptions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openMemoryDetail = useCallback((id: number) => {
    setSelectedMemoryId(id);
    setActiveView("memories");
  }, []);

  const loadMemoryDetail = useCallback(async (id: number, includeContent = false) => {
    setIsLoadingDetail(true);
    setMemoryDetailError(null);
    try {
      setMemoryDetail(await fetchMemoryDetail(id, { includeContent }));
    } catch (detailError) {
      setMemoryDetail(null);
      setMemoryDetailError(
        detailError instanceof Error ? detailError.message : String(detailError),
      );
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedMemoryId !== null) {
      void loadMemoryDetail(selectedMemoryId);
    }
  }, [loadMemoryDetail, selectedMemoryId]);

  return (
    <main className="app-shell">
      <nav className="app-nav" aria-label="Dashboard navigation">
        <div className="brand">
          Codex Memory
          <br />
          Sidecar
        </div>
        {NAV_ITEMS.map((item) => (
          <button
            className={`nav-button ${activeView === item.id ? "active" : ""}`}
            data-view-target={item.id}
            key={item.id}
            onClick={() => setActiveView(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
        <button id="refresh" onClick={() => void refresh()} type="button">
          {isRefreshing ? "更新中" : "更新"}
        </button>
      </nav>

      <section className="app-content">
        {error ? <div className="banner error">Dashboardを更新できません: {error}</div> : null}
        <section
          className={`app-view ${activeView === "observatory" ? "active" : ""}`}
          id="view-observatory"
        >
          <ObservatoryView
            active={activeView === "observatory"}
            graph={graph}
            graphOptions={graphOptions}
            onGraphOptionsChange={setGraphOptions}
            onOpenMemory={openMemoryDetail}
          />
        </section>
        <ViewFrame active={activeView === "health"} id="health">
          <HealthView status={status} />
        </ViewFrame>
        <ViewFrame active={activeView === "memories"} id="memories">
          <MemoriesView
            detail={memoryDetail}
            detailError={memoryDetailError}
            isLoadingDetail={isLoadingDetail}
            onOpenMemory={openMemoryDetail}
            onRevealContent={(id) => void loadMemoryDetail(id, true)}
            selectedMemoryId={selectedMemoryId}
            status={status}
          />
        </ViewFrame>
        <ViewFrame active={activeView === "directives"} id="directives">
          <DirectivesView status={status} />
        </ViewFrame>
        <ViewFrame active={activeView === "maintenance"} id="maintenance">
          <MaintenanceView status={status} />
        </ViewFrame>
        <ViewFrame active={activeView === "events"} id="events">
          <EventsView status={status} />
        </ViewFrame>
        <ViewFrame active={activeView === "settings"} id="settings">
          <SettingsView status={status} graph={graph} />
        </ViewFrame>
      </section>
    </main>
  );
}

function ViewFrame({ active, children, id }: { active: boolean; children: ReactNode; id: ViewId }) {
  return (
    <section className={`app-view ${active ? "active" : ""}`} id={`view-${id}`}>
      {children}
    </section>
  );
}

function HealthView({ status }: { status: DashboardStatus | null }) {
  return (
    <>
      <h1>状態</h1>
      <section className="grid">
        <Metric label="状態" status={status?.ok ? "ok" : "warn"} value={status?.ok ? "OK" : "-"} />
        <Metric label="メモリ" value={status?.database.memoryCount ?? "-"} />
        <Metric label="イベント" value={status?.database.eventCount ?? "-"} />
        <Metric
          label="データベース"
          status={status?.database.ok ? "ok" : "warn"}
          value={status?.database.ok ? "OK" : "-"}
        />
        <Metric
          label="Embedding"
          status={status?.embedding.ok ? "ok" : "warn"}
          value={status?.embedding.ok ? status.embedding.dimensions : "-"}
        />
      </section>
      <h2>Ollama モデル</h2>
      <section className="stats-grid">
        <Metric
          label="接続"
          status={status?.ollama && (status.ollama.ok || !status.ollama.required) ? "ok" : "warn"}
          value={status?.ollama ? (status.ollama.ok ? "OK" : "確認") : "無効"}
        />
        <Panel title="設定済みモデル">
          <StatsList
            values={{
              endpoint: status?.ollama?.baseUrl ?? "-",
              embedding: modelStatus(
                status?.ollama?.embeddingModel,
                status?.ollama?.embeddingModelAvailable,
              ),
              maintenance: modelStatus(
                status?.ollama?.maintenanceModel,
                status?.ollama?.maintenanceModelAvailable,
              ),
            }}
          />
        </Panel>
        <Panel title="利用可能モデル">
          <ul className="stats-list">
            {(status?.ollama?.modelNames.length ? status.ollama.modelNames : ["-"]).map((name) => (
              <li key={name}>
                <span>{name}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </>
  );
}

function MemoriesView({
  detail,
  detailError,
  isLoadingDetail,
  onOpenMemory,
  onRevealContent,
  selectedMemoryId,
  status,
}: {
  detail: MemoryDetail | null;
  detailError: string | null;
  isLoadingDetail: boolean;
  onOpenMemory: (id: number) => void;
  onRevealContent: (id: number) => void;
  selectedMemoryId: number | null;
  status: DashboardStatus | null;
}) {
  return (
    <>
      <h1>メモリ</h1>
      <h2>メモリ統計</h2>
      <section className="stats-grid">
        <Panel title="状態別">
          <StatsList
            values={
              status?.memoryStats.byStatus ?? { active: "-", superseded: "-", forgotten: "-" }
            }
          />
        </Panel>
        <Panel title="レイヤー別">
          <StatsList
            values={status?.memoryStats.byLayer ?? { core: "-", recall: "-", archival: "-" }}
          />
        </Panel>
        <Panel title="更新日時">
          <StatsList
            values={{
              oldest: status?.memoryStats.updatedAtRange.oldest ?? "-",
              newest: status?.memoryStats.updatedAtRange.newest ?? "-",
            }}
          />
        </Panel>
      </section>
      <h2>メモリ鮮度</h2>
      <section className="stats-grid">
        <Panel title="通常メモリの追従状態">
          <StatsList
            values={{
              状態: freshnessLabel(status?.memoryFreshness.status),
              最新メモリ更新: status?.memoryFreshness.latestMemoryUpdatedAt ?? "-",
              最新作業: status?.memoryFreshness.latestWorkspaceActivityAt ?? "-",
              候補数: status?.memoryFreshness.candidateCount ?? "-",
              対応: status?.memoryFreshness.recommendedAction ?? "-",
            }}
          />
        </Panel>
        <Panel title="保存候補">
          <CandidateList candidates={status?.memoryUpdateCandidates ?? []} />
        </Panel>
        <Panel title="Auto Memory Curation">
          <StatsList
            values={{
              mode: status?.autoMemoryCuration.mode ?? "-",
              threshold: status?.autoMemoryCuration.threshold ?? "-",
              evaluated: status?.autoMemoryCuration.evaluatedCount ?? "-",
              review: status?.autoMemoryCuration.reviewCount ?? "-",
              safe候補: status?.autoMemoryCuration.autoWriteEligibleCount ?? "-",
              skip: status?.autoMemoryCuration.skippedCount ?? "-",
            }}
          />
        </Panel>
      </section>
      <h2>プロジェクトスコープ</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>スコープ</th>
              <th>有効</th>
              <th>合計</th>
              <th>最新</th>
            </tr>
          </thead>
          <tbody>
            {(status?.memoryStats.byProjectScope ?? []).map((scope) => (
              <tr key={scope.projectScope}>
                <td className="summary">{scope.projectScope}</td>
                <td>{scope.active}</td>
                <td>{scope.total}</td>
                <td>{scope.latestUpdatedAt ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>最近のメモリ</h2>
      <div className="table-wrap wide">
        <MemoryTable memories={status?.recentMemories ?? []} onOpenMemory={onOpenMemory} />
      </div>
      <MemoryDetailPanel
        detail={detail}
        detailError={detailError}
        isLoading={isLoadingDetail}
        onRevealContent={onRevealContent}
        selectedMemoryId={selectedMemoryId}
      />
    </>
  );
}

function DirectivesView({ status }: { status: DashboardStatus | null }) {
  return (
    <>
      <h1>Directive Memory</h1>
      <h2>Directive Memory</h2>
      <DirectiveTable
        directives={status?.directives ?? []}
        emptyLabel="保存済み directive memory はありません"
      />
      <h2>無効化済み Directive Memory</h2>
      <DirectiveTable
        directives={status?.disabledDirectives ?? []}
        emptyLabel="無効化済み directive memory はありません"
      />
    </>
  );
}

function MaintenanceView({ status }: { status: DashboardStatus | null }) {
  return (
    <>
      <h1>メンテナンス</h1>
      <section className="stats-grid">
        <Metric
          label="インデックス修復"
          status={status?.maintenance.repairRecommended ? "warn" : "ok"}
          value={status?.maintenance.repairRecommended ? "推奨" : "不要"}
        />
        <Panel title="最新バックアップ">
          <StatsList
            values={{
              path: status?.maintenance.latestBackup?.backupPath ?? "-",
              size: status?.maintenance.latestBackup?.sizeBytes ?? "-",
              modified: status?.maintenance.latestBackup?.mtime ?? "-",
            }}
          />
        </Panel>
        <Panel title="バックアップ保持">
          <StatsList
            values={{
              directory: status?.maintenance.backupRetention.backupDir ?? "-",
              backups: status?.maintenance.backupRetention.backupCount ?? "-",
              kept: status
                ? `${status.maintenance.backupRetention.keptCount} / ${status.maintenance.backupRetention.keepCount}`
                : "-",
              prunable: status?.maintenance.backupRetention.prunableCount ?? "-",
              prunableBytes: status?.maintenance.backupRetention.prunableSizeBytes ?? "-",
            }}
          />
        </Panel>
        <Panel title="警告と対応">
          <WarningList actions={status?.warningActions ?? []} warnings={status?.warnings ?? []} />
        </Panel>
      </section>
    </>
  );
}

function EventsView({ status }: { status: DashboardStatus | null }) {
  return (
    <>
      <h1>イベント</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>メモリ</th>
              <th>種類</th>
              <th>作成</th>
            </tr>
          </thead>
          <tbody>
            {(status?.recentEvents ?? []).map((event) => (
              <tr key={event.id}>
                <td>{event.id}</td>
                <td>{event.memoryId}</td>
                <td>{event.eventType}</td>
                <td>{event.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SettingsView({
  graph,
  status,
}: {
  graph: MemoryGraph | null;
  status: DashboardStatus | null;
}) {
  return (
    <>
      <h1>設定</h1>
      <section className="stats-grid">
        <Panel title="Dashboard">
          <StatsList
            values={{
              schema: status?.dashboard.schemaVersion ?? "-",
              build: status?.dashboard.buildFingerprint ?? "-",
              refresh: "manual",
              privacy: graph?.privacy ? "summary / metadata only" : "summary / metadata only",
              renderer: "React + Vite",
            }}
          />
        </Panel>
      </section>
    </>
  );
}

function Metric({
  label,
  status,
  value,
}: {
  label: string;
  status?: "ok" | "warn";
  value: ReactNode;
}) {
  return (
    <div className="panel metric">
      <p className="label">{label}</p>
      <p
        className={`value ${status === "ok" ? "status-ok" : status === "warn" ? "status-warn" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="panel">
      <p className="label">{title}</p>
      {children}
    </div>
  );
}

function StatsList({ values }: { values: Record<string, ReactNode> }) {
  return (
    <ul className="stats-list">
      {Object.entries(values).map(([key, value]) => (
        <li key={key}>
          <span>{key}</span>
          <strong>{value}</strong>
        </li>
      ))}
    </ul>
  );
}

function CandidateList({ candidates }: { candidates: MemoryUpdateCandidate[] }) {
  if (!candidates.length) {
    return <StatsList values={{ 保存候補: "なし" }} />;
  }
  return (
    <ul className="stats-list action-list">
      {candidates.map((candidate) => (
        <li key={`${candidate.sourceType}:${candidate.sourceRef}`}>
          <span className="action-title">{candidate.summary}</span>
          <span className="action-body">理由: {candidate.reason}</span>
          <span className="action-body">
            情報源: {candidate.sourceType}: {candidate.sourceRef}
          </span>
          <span className="action-body">推奨: {candidate.suggestedTool}</span>
        </li>
      ))}
    </ul>
  );
}

function WarningList({ actions, warnings }: { actions: WarningAction[]; warnings: string[] }) {
  if (actions.length) {
    return (
      <ul className="stats-list action-list">
        {actions.map((action) => (
          <li key={`${action.title}:${action.action}`}>
            <span className="action-title">{action.title}</span>
            <span className="action-body">{action.message}</span>
            <span className="action-body">対応: {action.action}</span>
            {action.tools.length ? (
              <span className="action-body">関連ツール: {action.tools.join(", ")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  return <StatsList values={{ current: warnings.length ? warnings.join(" / ") : "none" }} />;
}

function MemoryTable({
  memories,
  onOpenMemory,
}: {
  memories: RecentMemory[];
  onOpenMemory: (id: number) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>レイヤー</th>
          <th>要約</th>
          <th>情報源</th>
          <th>スコープ</th>
          <th>タグ</th>
          <th>更新</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {memories.map((memory) => (
          <tr key={memory.id}>
            <td>{memory.id}</td>
            <td>{memory.layer}</td>
            <td className="summary">{memory.summary}</td>
            <td className="tags">
              {memory.sourceType}: {memory.sourceRef}
            </td>
            <td className="tags">{memory.projectScope}</td>
            <td className="tags">{memory.tags.join(", ")}</td>
            <td>{memory.updatedAt}</td>
            <td>
              <button
                className="link-button"
                data-memory-detail-id={memory.id}
                onClick={() => onOpenMemory(memory.id)}
                type="button"
              >
                詳細
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MemoryDetailPanel({
  detail,
  detailError,
  isLoading,
  onRevealContent,
  selectedMemoryId,
}: {
  detail: MemoryDetail | null;
  detailError: string | null;
  isLoading: boolean;
  onRevealContent: (id: number) => void;
  selectedMemoryId: number | null;
}) {
  const meta = useMemo(() => {
    if (!detail) {
      return {};
    }
    return {
      status: detail.status,
      source: `${detail.sourceType}: ${detail.sourceRef}`,
      project: detail.projectScope,
      tags: detail.tags.join(", ") || "-",
      importance: detail.importance.toFixed(2),
      confidence: detail.confidence.toFixed(2),
      updated: detail.updatedAt,
      validFrom: detail.validFrom,
      invalidatedAt: detail.invalidatedAt ?? "-",
      invalidatedByRef: detail.invalidatedByRef ?? "-",
    };
  }, [detail]);

  return (
    <section
      className={`panel detail-panel ${detail || selectedMemoryId ? "" : "empty"}`}
      id="memory-detail"
    >
      <p className="label">メモリ詳細</p>
      <h2 id="memory-detail-title">
        {selectedMemoryId ? `Memory #${selectedMemoryId}` : "メモリを選択してください"}
      </h2>
      {isLoading ? <div className="tags">詳細を読み込んでいます。</div> : null}
      {detailError ? <div className="banner error">{detailError}</div> : null}
      {detail ? (
        <>
          <div className="detail-grid" id="memory-detail-meta">
            {Object.entries(meta).map(([key, value]) => (
              <div key={key}>
                <p className="label">{key}</p>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="detail-actions" id="memory-detail-actions">
            {detail.sourceUrl ? (
              <a className="source-link" href={detail.sourceUrl} rel="noreferrer" target="_blank">
                sourceRefを開く
              </a>
            ) : (
              <span className="tags">sourceRefリンクなし</span>
            )}
            {detail.contentAvailable && !detail.contentIncluded ? (
              <button
                className="link-button"
                id="memory-content-reveal"
                onClick={() => onRevealContent(detail.id)}
                type="button"
              >
                本文を表示
              </button>
            ) : null}
          </div>
          <div id="memory-detail-content">
            <p className="summary">{detail.summary}</p>
            {detail.contentIncluded ? (
              <pre className="memory-content">{detail.content ?? ""}</pre>
            ) : (
              <p className="tags">本文は明示的に開くまで表示しません。</p>
            )}
          </div>
          <div className="detail-guidance">
            <InfoListSection items={detail.known} title="分かること" />
            <InfoListSection items={detail.unknown} title="分からないこと" />
            <InfoListSection items={detail.verificationHints} title="追加で確認する場所" />
          </div>
        </>
      ) : selectedMemoryId || isLoading || detailError ? null : (
        <div className="tags">
          Observatoryのノード、または最近のメモリ一覧の「詳細」から確認できます。本文は明示的に開くまで表示しません。
        </div>
      )}
    </section>
  );
}

function InfoListSection({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="detail-section">
      <p className="label">{title}</p>
      <ul className="detail-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function DirectiveTable({
  directives,
  emptyLabel,
}: {
  directives: DirectiveMemory[];
  emptyLabel: string;
}) {
  return (
    <div className="table-wrap wide">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>範囲</th>
            <th>スコープ</th>
            <th>指示内容</th>
            <th>理由</th>
            <th>情報源</th>
            <th>更新</th>
          </tr>
        </thead>
        <tbody>
          {directives.length ? (
            directives.map((directive) => (
              <tr key={directive.id}>
                <td>{directive.id}</td>
                <td>{directive.scope}</td>
                <td className="tags">{directive.projectScope}</td>
                <td className="summary">{directive.content}</td>
                <td className="summary">{directive.rationale}</td>
                <td className="tags">
                  {directive.sourceType}: {directive.sourceRef}
                </td>
                <td>{directive.updatedAt}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7}>{emptyLabel}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function modelStatus(model: string | undefined, available: boolean | undefined) {
  if (!model) {
    return "-";
  }
  return `${model} / ${available ? "利用可" : "不足"}`;
}

function freshnessLabel(status: string | undefined) {
  return (
    {
      fresh: "新しい",
      stale: "古い可能性",
      empty: "未保存",
      unknown: "不明",
    }[status ?? ""] ??
    status ??
    "-"
  );
}
