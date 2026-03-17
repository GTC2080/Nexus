import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo } from "../types";
import { parseSpectroscopy, type SpectrumData } from "../utils/spectroscopyParser";

// Lazy-load Plotly to keep initial bundle small
import Plot from "react-plotly.js";

interface SpectroscopyViewerProps {
  note: NoteInfo;
}

type ViewerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SpectrumData };

export default function SpectroscopyViewer({ note }: SpectroscopyViewerProps) {
  const [state, setState] = useState<ViewerState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const raw = await invoke<string>("read_note", { filePath: note.path });
        if (cancelled) return;
        const data = parseSpectroscopy(raw, note.file_extension);
        setState({ status: "ready", data });
      } catch (e) {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Unrecognized Data Format",
        });
      }
    })();

    return () => { cancelled = true; };
  }, [note.id, note.path, note.file_extension]);

  const plotConfig = useMemo(() => {
    if (state.status !== "ready") return null;
    const { data } = state;

    const trace: Plotly.Data = {
      x: data.x,
      y: data.y,
      type: "scattergl",
      mode: "lines",
      line: { color: "#3B82F6", width: 1.5 },
      hoverinfo: "x+y",
    };

    const axisBase = {
      gridcolor: "#222222",
      gridwidth: 1,
      linecolor: "#444444",
      linewidth: 1,
      tickfont: { family: "monospace", size: 11, color: "#888888" },
      titlefont: { family: "monospace", size: 12, color: "#888888" },
      zerolinecolor: "#333333",
    };

    const layout: Partial<Plotly.Layout> = {
      plot_bgcolor: "transparent",
      paper_bgcolor: "transparent",
      margin: { t: 40, r: 32, b: 56, l: 72 },
      xaxis: {
        ...axisBase,
        title: { text: data.xLabel, standoff: 12 },
        ...(data.isNMR ? { autorange: "reversed" as const } : {}),
      },
      yaxis: {
        ...axisBase,
        title: { text: data.yLabel, standoff: 12 },
      },
      title: data.title
        ? {
            text: data.title,
            font: { family: "monospace", size: 13, color: "#888888" },
            x: 0.5,
            xanchor: "center",
          }
        : undefined,
      dragmode: "zoom",
      hovermode: "closest",
      hoverlabel: {
        bgcolor: "#1A1A1A",
        bordercolor: "#444444",
        font: { family: "monospace", size: 11, color: "#EDEDED" },
      },
      autosize: true,
    };

    const config: Partial<Plotly.Config> = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "sendDataToCloud"],
      scrollZoom: true,
    };

    return { trace, layout, config };
  }, [state]);

  // Loading skeleton
  if (state.status === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <div className="w-64 h-40 rounded-lg bg-white/[0.04]" />
          <span className="text-[12px] text-[var(--text-quaternary)]">
            Loading spectrum...
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (state.status === "error") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[14px] text-[var(--text-quaternary)]">
          {state.message}
        </span>
      </div>
    );
  }

  // Ready — render Plotly chart
  const { trace, layout, config } = plotConfig!;
  const pointCount = state.data.x.length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Info bar */}
      <div className="flex items-center gap-4 px-6 py-2 border-b-[0.5px] border-b-[var(--panel-border)]">
        <span className="text-[11px] font-mono text-[var(--text-quaternary)]">
          {pointCount.toLocaleString()} pts
        </span>
        {state.data.isNMR && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6] font-mono">
            NMR
          </span>
        )}
        <span className="text-[11px] font-mono text-[var(--text-quaternary)]">
          {state.data.xLabel} → {state.data.yLabel}
        </span>
      </div>
      {/* Plot */}
      <div className="flex-1 min-h-0">
        <Plot
          data={[trace]}
          layout={layout}
          config={config}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
