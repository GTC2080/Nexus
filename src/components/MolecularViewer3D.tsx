import { useRef, useEffect, useState } from "react";

interface MolecularViewer3DProps {
  data: string;
  format: string; // "pdb" | "xyz" | "cif"
}

export default function MolecularViewer3D({ data, format }: MolecularViewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    if (!containerRef.current) return;
    if (!data.trim()) {
      setLoading(false);
      setError("分子文件为空，无法渲染");
      return;
    }

    let destroyed = false;
    let cleanupResize: (() => void) | null = null;

    (async () => {
      try {
        // Dynamic import to avoid loading WebGL on non-chemistry pages
        const $3Dmol = await import("3dmol");

        if (destroyed || !containerRef.current) return;

        // Clear any prior viewer
        if (viewerRef.current) {
          try { viewerRef.current.clear(); } catch { /* ignore */ }
          viewerRef.current = null;
        }
        containerRef.current.innerHTML = "";

        const viewer = $3Dmol.createViewer(containerRef.current, {
          backgroundColor: "rgba(0,0,0,0)",
          antialias: true,
          cartoonQuality: 8,
        });

        viewerRef.current = viewer;

        // Map format string for 3Dmol
        const formatMap: Record<string, string> = {
          pdb: "pdb",
          xyz: "xyz",
          cif: "cif",
        };
        const mol3dFormat = formatMap[format.toLowerCase()] ?? "pdb";

        viewer.addModel(data, mol3dFormat);

        // Default style: ball+stick for small molecules, cartoon+stick for proteins
        const atomCount = viewer.getModel(0)?.selectedAtoms({})?.length ?? 0;
        if (atomCount > 500) {
          // Large structures (proteins) — cartoon + muted stick for ligands
          viewer.setStyle({}, { cartoon: { color: "spectrum", opacity: 0.9 } });
          viewer.setStyle({ hetflag: true }, { stick: { radius: 0.15, colorscheme: "Jmol" } });
        } else {
          // Small molecules — ball+stick
          viewer.setStyle({}, {
            stick: { radius: 0.14, colorscheme: "Jmol" },
            sphere: { scale: 0.25, colorscheme: "Jmol" },
          });
        }

        viewer.zoomTo();
        viewer.render();
        viewer.zoom(0.9, 300);

        const handleResize = () => {
          if (!viewerRef.current) return;
          try {
            viewerRef.current.resize();
            viewerRef.current.render();
          } catch {
            // ignore resize issues during teardown
          }
        };

        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          const observer = new ResizeObserver(() => handleResize());
          observer.observe(containerRef.current);
          cleanupResize = () => observer.disconnect();
        } else {
          window.addEventListener("resize", handleResize);
          cleanupResize = () => window.removeEventListener("resize", handleResize);
        }
        requestAnimationFrame(handleResize);

        if (!destroyed) {
          setLoading(false);
          setError(null);
        }
      } catch (e) {
        if (!destroyed) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      destroyed = true;
      cleanupResize?.();
      // Critical: destroy WebGL context to prevent memory leaks
      if (viewerRef.current) {
        try {
          viewerRef.current.clear();
          viewerRef.current = null;
        } catch { /* ignore cleanup errors */ }
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [data, format]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-8 max-w-md">
          <svg className="mx-auto w-10 h-10 mb-4 text-[var(--text-quaternary)]"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-[var(--text-tertiary)] mb-2">无法渲染分子结构</p>
          <p className="text-xs text-[var(--text-quaternary)] font-mono break-all">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative" style={{ background: "#0A0A0A" }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--text-quaternary)]">加载分子结构…</span>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{
          position: "relative",
          // Ensure the viewer fills the container
          minHeight: "100%",
        }}
      />
    </div>
  );
}
