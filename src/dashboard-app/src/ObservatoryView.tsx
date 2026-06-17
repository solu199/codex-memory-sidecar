import { useEffect, useMemo, useRef, useState } from "react";

import { createObservatoryEngine, type ObservatoryEngine } from "./observatory-engine";
import type { MemoryGraph } from "./types";

const OBSERVATORY_RUNTIME_SRC = "/assets/observatory-3d.bundle.js";

export function ObservatoryView({
  active,
  graph,
  onOpenMemory,
}: {
  active: boolean;
  graph: MemoryGraph | null;
  onOpenMemory: (id: number) => void;
}) {
  const graphRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ObservatoryEngine | null>(null);
  const [mode, setMode] = useState<"live" | "replay" | "explore">("live");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [showTitles, setShowTitles] = useState(true);
  const [showSim, setShowSim] = useState(true);
  const [showHebb, setShowHebb] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [lowPowerMode, setLowPowerMode] = useState(true);
  const [fogOn, setFogOn] = useState(true);
  const [simH, setSimH] = useState(720);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(6);
  const [runtimeReady, setRuntimeReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadObservatoryRuntime().finally(() => {
      if (!cancelled) {
        setRuntimeReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!graphRef.current || !graph || !runtimeReady) {
      return;
    }
    engineRef.current?.destroy();
    engineRef.current = createObservatoryEngine({
      container: graphRef.current,
      graph,
      onReplayTimeChange: setSimH,
      onOpenMemory,
    });
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [graph, onOpenMemory, runtimeReady]);

  const settings = useMemo(
    () => ({
      active,
      autoRotate,
      fogOn,
      lowPowerMode,
      mode,
      paused,
      replayPlaying,
      replaySpeed,
      search,
      showHebb,
      showSim,
      showTitles,
      simH,
    }),
    [
      active,
      autoRotate,
      fogOn,
      lowPowerMode,
      mode,
      paused,
      replayPlaying,
      replaySpeed,
      search,
      showHebb,
      showSim,
      showTitles,
      simH,
    ],
  );

  useEffect(() => {
    engineRef.current?.update(settings);
  }, [settings]);

  const modeButtons = [
    { id: "live" as const, label: "ライブ" },
    { id: "replay" as const, label: "リプレイ" },
    { id: "explore" as const, label: "探索" },
  ];

  return (
    <div className="observatory-prototype" id="observatory-app">
      <header>
        <h1>
          Memory Observatory <span className="accent-blue">3D</span>
          <span className="sub">活性度 / 忘却の霧 / 回転・ズーム・ドラッグ対応</span>
        </h1>
        <div className="spacer" />
        <input
          id="searchBox"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="summary / tags / sourceRef を検索"
          value={search}
        />
        <details className="observatory-mode-drawer">
          <summary>表示モード</summary>
          <div className="observatory-mode-panel">
            <div className="observatory-tabs">
              {modeButtons.map((button) => (
                <button
                  className={mode === button.id ? "active" : ""}
                  id={`tab${capitalize(button.id)}`}
                  key={button.id}
                  onClick={() => {
                    setMode(button.id);
                    if (button.id !== "replay") {
                      setReplayPlaying(false);
                    }
                  }}
                  type="button"
                >
                  {button.label}
                </button>
              ))}
            </div>
            <button
              className="ctrl"
              id="pauseBtn"
              onClick={() => setPaused((value) => !value)}
              type="button"
            >
              {paused ? "再開" : "一時停止"}
            </button>
          </div>
        </details>
      </header>
      <div className="observatory-main">
        <div id="graph" ref={graphRef}>
          {!graph || !runtimeReady ? <div id="loading">LOADING 3D ENGINE...</div> : null}
        </div>
        <aside>
          <h2>想起フィード</h2>
          <ul id="feed" />
          <h2>忘却予測 (7日後の想起率)</h2>
          <div id="forecast" />
          <h2>クラスタ凡例</h2>
          <div id="legend" />
          <h2>統計</h2>
          <div id="stats" />
          <h2>表示設定</h2>
          <label className="opt">
            <input
              checked={showTitles}
              id="showTitles"
              onChange={(event) => setShowTitles(event.target.checked)}
              type="checkbox"
            />
            タイトル表示
          </label>
          <label className="opt">
            <input
              checked={showSim}
              id="showSim"
              onChange={(event) => setShowSim(event.target.checked)}
              type="checkbox"
            />
            類似エッジ
          </label>
          <label className="opt">
            <input
              checked={showHebb}
              id="showHebb"
              onChange={(event) => setShowHebb(event.target.checked)}
              type="checkbox"
            />
            共起エッジ
          </label>
          <label className="opt">
            <input
              checked={autoRotate}
              id="autoRotate"
              onChange={(event) => setAutoRotate(event.target.checked)}
              type="checkbox"
            />
            自動回転
          </label>
          <label className="opt">
            <input
              checked={lowPowerMode}
              id="lowPowerMode"
              onChange={(event) => setLowPowerMode(event.target.checked)}
              type="checkbox"
            />
            省電力モード
          </label>
          <label className="opt">
            <input
              checked={fogOn}
              id="fogOn"
              onChange={(event) => setFogOn(event.target.checked)}
              type="checkbox"
            />
            忘却の霧
          </label>
          <div className="hint">
            奥行き(Z軸)はACT-R風の活性度です。よく想起される記憶ほど手前に浮上し、忘れられつつある記憶は霧の奥へ沈みます。Ctrl+ホバーで要約を表示します。
          </div>
        </aside>
      </div>
      <footer className={mode === "replay" ? "show" : ""} id="timeline">
        <button
          className="ctrl"
          id="replayPlay"
          onClick={() => setReplayPlaying((value) => !value)}
          type="button"
        >
          {replayPlaying ? "停止" : "再生"}
        </button>
        <span id="timeLabel">{formatReplayLabel(simH)}</span>
        <input
          id="scrub"
          max="720"
          min="0"
          onChange={(event) => setSimH(Number(event.target.value))}
          step="0.25"
          type="range"
          value={simH}
        />
        <select
          id="replaySpeed"
          onChange={(event) => setReplaySpeed(Number(event.target.value))}
          value={replaySpeed}
        >
          <option value="2">2時間/秒</option>
          <option value="6">6時間/秒</option>
          <option value="24">24時間/秒</option>
        </select>
      </footer>
      <div id="tooltip" />
    </div>
  );
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatReplayLabel(simH: number) {
  return `Day ${Math.floor(simH / 24)} ${String(Math.floor(simH % 24)).padStart(2, "0")}:00`;
}

function loadObservatoryRuntime(): Promise<void> {
  const runtimeWindow = window as Window & {
    ForceGraph3D?: unknown;
    THREE?: unknown;
    __codexMemoryObservatoryRuntime?: Promise<void>;
  };
  if (runtimeWindow.ForceGraph3D && runtimeWindow.THREE) {
    return Promise.resolve();
  }
  if (runtimeWindow.__codexMemoryObservatoryRuntime) {
    return runtimeWindow.__codexMemoryObservatoryRuntime;
  }
  runtimeWindow.__codexMemoryObservatoryRuntime = new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${OBSERVATORY_RUNTIME_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.async = true;
    script.src = OBSERVATORY_RUNTIME_SRC;
    script.dataset.observatoryRuntime = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => resolve(), { once: true });
    if (existing) {
      window.setTimeout(resolve, 0);
    } else {
      document.head.appendChild(script);
    }
  });
  return runtimeWindow.__codexMemoryObservatoryRuntime;
}
