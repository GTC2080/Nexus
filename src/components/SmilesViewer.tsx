import { useRef, useEffect, useState } from "react";

interface SmilesViewerProps {
  smiles: string;
  width?: number;
  height?: number;
  compact?: boolean;
}

const THEME = {
  C: "#EDEDED",
  O: "#E06060",
  N: "#6090E0",
  S: "#D4A840",
  P: "#E08040",
  F: "#60D060",
  CL: "#60D060",
  BR: "#C04030",
  I: "#8040C0",
  H: "#CCCCCC",
  BACKGROUND: "transparent",
};

export default function SmilesViewer({ smiles, width = 320, height = 240, compact = false }: SmilesViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.some(entry => entry.isIntersecting);
        setIsVisible(visible);
      },
      { root: null, rootMargin: "120px", threshold: 0.01 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!isVisible) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // smiles-drawer ships as a UMD/ESM hybrid; handle both
        const mod = await import("smiles-drawer") as any;
        const SmiDrawer = mod.SmiDrawer ?? mod.default?.SmiDrawer ?? mod.default;

        if (!SmiDrawer) {
          setError(true);
          return;
        }

        const drawer = new SmiDrawer({
          width,
          height,
          bondThickness: 1.2,
          bondLength: compact ? 16 : 20,
          shortBondLength: 0.8,
          fontSizeLarge: compact ? 10 : 12,
          fontSizeSmall: compact ? 7 : 8,
          padding: compact ? 14 : 24,
          themes: {
            dark: {
              C: THEME.C,
              O: THEME.O,
              N: THEME.N,
              S: THEME.S,
              P: THEME.P,
              F: THEME.F,
              CL: THEME.CL,
              BR: THEME.BR,
              I: THEME.I,
              H: THEME.H,
              BACKGROUND: THEME.BACKGROUND,
            },
          },
        });

        const cleanSmiles = (smiles ?? "").toString().trim();
        if (!cleanSmiles) {
          setError(true);
          return;
        }

        // SmiDrawer.parse returns a Promise
        SmiDrawer.parse(cleanSmiles, (tree: any) => {
          if (cancelled) return;
          setError(false);
          drawer.draw(tree, canvas, "dark");
        }, () => {
          if (cancelled) return;
          setError(true);
        });
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => { cancelled = true; };
  }, [compact, height, isVisible, smiles, width]);

  if (error) {
    return (
      <div ref={containerRef} className="smiles-error flex items-center justify-center rounded-[12px] py-6 px-4">
        <span className="smiles-error-text text-[12px] font-mono">
          [Invalid SMILES String]
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="smiles-container flex items-center justify-center rounded-[12px] py-4 px-4 my-2">
      <canvas
        ref={canvasRef}
        className="smiles-canvas"
        width={width}
        height={height}
      />
    </div>
  );
}
