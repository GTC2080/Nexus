import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { NoteInfo } from "../types";
import { getFileCategory } from "../types";
import PdfViewer from "./PdfViewer";

interface PublishStudioProps {
  notes: NoteInfo[];
  initialContent: string;
  onSave: (content: string) => void | Promise<void>;
}

interface PaperDocumentState {
  nodeIds: string[];
  template: string;
  cslPath: string;
  bibliographyPath: string;
}

interface CompilerEnvironmentStatus {
  ready: boolean;
  pandocAvailable: boolean;
  latexEngineAvailable: boolean;
  message: string;
}

interface CompilePayload {
  markdown: string;
  imagePaths: string[];
  template: string;
  cslPath: string | null;
  bibliographyPath: string | null;
}

interface DragMeta {
  origin: "source" | "assembly";
  noteId: string;
}

const ASSEMBLY_DROP_ID = "assembly:drop";

function defaultPaperState(): PaperDocumentState {
  return {
    nodeIds: [],
    template: "standard-thesis",
    cslPath: "",
    bibliographyPath: "",
  };
}

function parsePaperState(raw: string): PaperDocumentState {
  if (!raw.trim()) {
    return defaultPaperState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PaperDocumentState> | null;
    if (!parsed || typeof parsed !== "object") {
      return defaultPaperState();
    }

    const seen = new Set<string>();
    const nodeIds = Array.isArray(parsed.nodeIds)
      ? parsed.nodeIds.filter((id): id is string => {
        if (typeof id !== "string") return false;
        const normalized = id.trim();
        if (!normalized) return false;
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      : [];

    return {
      nodeIds,
      template: typeof parsed.template === "string" && parsed.template.trim()
        ? parsed.template
        : "standard-thesis",
      cslPath: typeof parsed.cslPath === "string" ? parsed.cslPath : "",
      bibliographyPath: typeof parsed.bibliographyPath === "string" ? parsed.bibliographyPath : "",
    };
  } catch {
    return defaultPaperState();
  }
}

function serializePaperState(state: PaperDocumentState): string {
  return JSON.stringify(state, null, 2);
}

function toTransformString(
  transform: { x: number; y: number; scaleX: number; scaleY: number } | null
): string | undefined {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`;
}

function normalizePathLike(path: string): string {
  return path.replace(/\\/g, "/");
}

function resolveResourcePath(notePath: string, imageRef: string): string | null {
  const cleaned = normalizePathLike(imageRef.trim()).replace(/^<|>$/g, "");
  if (!cleaned) return null;

  const lowered = cleaned.toLowerCase();
  if (
    lowered.startsWith("http://")
    || lowered.startsWith("https://")
    || lowered.startsWith("data:")
    || lowered.startsWith("file:")
  ) {
    return null;
  }

  if (/^[a-zA-Z]:\//.test(cleaned) || cleaned.startsWith("/")) {
    return cleaned;
  }

  const normalizedNote = normalizePathLike(notePath);
  const noteDir = normalizedNote.includes("/")
    ? normalizedNote.slice(0, normalizedNote.lastIndexOf("/"))
    : "";
  return noteDir ? `${noteDir}/${cleaned}` : cleaned;
}

function collectImagePaths(markdown: string, notePath: string): string[] {
  const matches = markdown.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g);
  const paths: string[] = [];
  for (const match of matches) {
    const value = match[1];
    if (!value) continue;
    const resolved = resolveResourcePath(notePath, value);
    if (resolved) paths.push(resolved);
  }
  return paths;
}

function stoichiometryToTable(blockContent: string): string {
  const rows = blockContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split(/[\t, ]+/).filter(cell => cell.length > 0));

  if (rows.length === 0) {
    return "| Value |\n| --- |\n|  |\n";
  }

  const maxColumns = Math.max(...rows.map(row => row.length), 1);
  const header = `| ${Array.from({ length: maxColumns }, (_, idx) => `C${idx + 1}`).join(" | ")} |`;
  const separator = `| ${Array.from({ length: maxColumns }, () => "---").join(" | ")} |`;
  const body = rows
    .map(row => `| ${Array.from({ length: maxColumns }, (_, idx) => row[idx] ?? "").join(" | ")} |`)
    .join("\n");

  return `${header}\n${separator}\n${body}\n`;
}

function preprocessMarkdown(markdown: string): string {
  // 保留 \ce{} 原文，避免破坏 mhchem 解析。
  return markdown.replace(/```stoichiometry\s*\n?([\s\S]*?)```/gi, (_, content: string) => {
    return stoichiometryToTable(content);
  });
}

function SourceNoteCard({ note, selected }: { note: NoteInfo; selected: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `source:${note.id}`,
    data: { origin: "source", noteId: note.id } satisfies DragMeta,
  });

  const style: CSSProperties = {
    opacity: isDragging ? 0.45 : selected ? 0.65 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      className="bg-[#141414] border border-[#333] p-3 mb-2 rounded text-sm text-[#CCC] cursor-grab hover:border-[#555]"
      title={note.path}
    >
      <div className="truncate">{note.name}</div>
      <div className="text-[11px] text-[#777] mt-1 truncate">{note.id}</div>
    </div>
  );
}

function AssemblyNoteCard({
  note,
  onRemove,
}: {
  note: NoteInfo;
  onRemove: (noteId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    data: { origin: "assembly", noteId: note.id } satisfies DragMeta,
  });

  const style: CSSProperties = {
    transform: toTransformString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-[#141414] border border-[#333] p-3 mb-2 rounded text-sm text-[#CCC] hover:border-[#555]"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...listeners}
          {...attributes}
          className="text-[#8A8A8A] hover:text-[#DDD] cursor-grab"
          title="拖动排序"
          aria-label="拖动排序"
        >
          ::
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate">{note.name}</div>
          <div className="text-[11px] text-[#777] mt-1 truncate">{note.id}</div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(note.id)}
          className="text-[#8A8A8A] hover:text-[#EEE] text-xs"
          title="移除"
          aria-label="移除"
        >
          REMOVE
        </button>
      </div>
    </div>
  );
}

export default function PublishStudio({
  notes,
  initialContent,
  onSave,
}: PublishStudioProps) {
  const [paperState, setPaperState] = useState<PaperDocumentState>(() => parsePaperState(initialContent));
  const [compilerStatus, setCompilerStatus] = useState<CompilerEnvironmentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState("");
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const saveSnapshotRef = useRef(serializePaperState(parsePaperState(initialContent)));

  const markdownNotes = useMemo(
    () => notes.filter(note => getFileCategory(note.file_extension) === "markdown"),
    [notes]
  );
  const markdownById = useMemo(() => {
    return new Map(markdownNotes.map(note => [note.id, note]));
  }, [markdownNotes]);
  const assemblyNotes = useMemo(() => {
    return paperState.nodeIds
      .map(noteId => markdownById.get(noteId))
      .filter((note): note is NoteInfo => !!note);
  }, [paperState.nodeIds, markdownById]);
  const assemblyIdSet = useMemo(() => new Set(paperState.nodeIds), [paperState.nodeIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );
  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({ id: ASSEMBLY_DROP_ID });

  useEffect(() => {
    const parsed = parsePaperState(initialContent);
    setPaperState(parsed);
    saveSnapshotRef.current = serializePaperState(parsed);
    setCompileError("");
    setPdfBytes(null);
  }, [initialContent]);

  useEffect(() => {
    setPaperState(prev => {
      const normalized = prev.nodeIds.filter(noteId => markdownById.has(noteId));
      if (normalized.length === prev.nodeIds.length) return prev;
      return { ...prev, nodeIds: normalized };
    });
  }, [markdownById]);

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);

    invoke<CompilerEnvironmentStatus>("get_compiler_status")
      .then(status => {
        if (!cancelled) {
          setCompilerStatus(status);
        }
      })
      .catch(error => {
        if (!cancelled) {
          setCompilerStatus({
            ready: false,
            pandocAvailable: false,
            latexEngineAvailable: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const serialized = serializePaperState(paperState);
    if (serialized === saveSnapshotRef.current) return;

    const timer = window.setTimeout(() => {
      void Promise.resolve(onSave(serialized))
        .then(() => {
          saveSnapshotRef.current = serialized;
        })
        .catch(() => undefined);
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [paperState, onSave]);

  const handleDragEnd = (event: DragEndEvent) => {
    const activeMeta = event.active.data.current as Partial<DragMeta> | undefined;
    const over = event.over;
    if (!activeMeta?.noteId || !over) return;
    const activeNoteId = activeMeta.noteId;

    const overId = String(over.id);
    const overMeta = over.data.current as Partial<DragMeta> | undefined;

    setPaperState(prev => {
      const ids = [...prev.nodeIds];

      if (activeMeta.origin === "source") {
        if (ids.includes(activeNoteId)) return prev;

        let insertIndex = ids.length;
        if (overId !== ASSEMBLY_DROP_ID) {
          const candidateId = overMeta?.noteId ?? overId;
          const idx = ids.indexOf(candidateId);
          if (idx >= 0) insertIndex = idx;
        }

        ids.splice(insertIndex, 0, activeNoteId);
        return { ...prev, nodeIds: ids };
      }

      if (activeMeta.origin === "assembly") {
        const oldIndex = ids.indexOf(activeNoteId);
        if (oldIndex < 0) return prev;

        let newIndex = oldIndex;
        if (overId === ASSEMBLY_DROP_ID) {
          newIndex = ids.length - 1;
        } else {
          const candidateId = overMeta?.noteId ?? overId;
          const idx = ids.indexOf(candidateId);
          if (idx >= 0) newIndex = idx;
        }

        if (newIndex === oldIndex) return prev;
        return { ...prev, nodeIds: arrayMove(ids, oldIndex, newIndex) };
      }

      return prev;
    });
  };

  const handleRemoveAssemblyNote = (noteId: string) => {
    setPaperState(prev => ({
      ...prev,
      nodeIds: prev.nodeIds.filter(id => id !== noteId),
    }));
  };

  const handleBuildPdf = async () => {
    setCompileError("");

    if (statusLoading) {
      setCompileError("正在检测编译环境，请稍后重试。");
      return;
    }
    if (!compilerStatus?.ready) {
      setCompileError(compilerStatus?.message || "未检测到 Pandoc/XeLaTeX 环境。");
      return;
    }
    if (assemblyNotes.length === 0) {
      setCompileError("请先拖入至少一个 Markdown 节点。");
      return;
    }

    setCompiling(true);
    try {
      const chunks = await Promise.all(
        assemblyNotes.map(async note => {
          const raw = await invoke<string>("read_note", { filePath: note.path });
          const cleaned = preprocessMarkdown(raw);
          const imagePaths = collectImagePaths(cleaned, note.path);
          return {
            title: note.name,
            markdown: cleaned,
            imagePaths,
          };
        })
      );

      const fullMarkdown = chunks
        .map(chunk => `# ${chunk.title}\n\n${chunk.markdown}`)
        .join("\n\n");

      const uniqueImagePaths = Array.from(
        new Set(chunks.flatMap(chunk => chunk.imagePaths))
      );

      const payload: CompilePayload = {
        markdown: fullMarkdown,
        imagePaths: uniqueImagePaths,
        template: paperState.template.trim() || "standard-thesis",
        cslPath: paperState.cslPath.trim() || null,
        bibliographyPath: paperState.bibliographyPath.trim() || null,
      };

      const pdfArray = await invoke<number[]>("compile_to_pdf", { payload });
      setPdfBytes(Uint8Array.from(pdfArray));
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : String(error));
    } finally {
      setCompiling(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#050505] text-[#EDEDED] overflow-hidden">
      <aside className="w-1/3 border-r border-[#222] flex flex-col">
        <div className="p-4 border-b border-[#1C1C1C]">
          <button
            type="button"
            onClick={handleBuildPdf}
            disabled={compiling || statusLoading}
            className={`bg-[#EDEDED] text-[#050505] px-4 py-2 text-sm font-bold ${compiling ? "animate-pulse" : ""} disabled:opacity-50`}
          >
            {compiling ? "[ COMPILING... ]" : "Build PDF"}
          </button>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[#A8A8A8]">
            <label className="flex items-center gap-2">
              <span className="w-20 text-[#8A8A8A]">Template</span>
              <select
                value={paperState.template}
                onChange={e => setPaperState(prev => ({ ...prev, template: e.target.value }))}
                className="flex-1 bg-[#0F0F0F] border border-[#2A2A2A] px-2 py-1 text-[#DDD] outline-none"
              >
                <option value="standard-thesis">standard-thesis</option>
                <option value="acs">acs</option>
                <option value="nature">nature</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-20 text-[#8A8A8A]">CSL</span>
              <input
                value={paperState.cslPath}
                onChange={e => setPaperState(prev => ({ ...prev, cslPath: e.target.value }))}
                className="flex-1 bg-[#0F0F0F] border border-[#2A2A2A] px-2 py-1 text-[#DDD] outline-none"
                placeholder="path/to/style.csl"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-20 text-[#8A8A8A]">BibTeX</span>
              <input
                value={paperState.bibliographyPath}
                onChange={e => setPaperState(prev => ({ ...prev, bibliographyPath: e.target.value }))}
                className="flex-1 bg-[#0F0F0F] border border-[#2A2A2A] px-2 py-1 text-[#DDD] outline-none"
                placeholder="path/to/references.bib"
              />
            </label>
          </div>
          {compilerStatus && !compilerStatus.ready && (
            <div className="mt-3 text-xs text-[#FF9B9B] whitespace-pre-wrap border border-[#4A2222] bg-[#120A0A] p-2">
              {compilerStatus.message}
            </div>
          )}
          {compileError && (
            <div className="mt-3 text-xs text-[#FF9B9B] whitespace-pre-wrap border border-[#4A2222] bg-[#120A0A] p-2 max-h-36 overflow-auto">
              {compileError}
            </div>
          )}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="flex-1 min-h-0 p-4 grid grid-cols-1 gap-4">
            <section className="min-h-0 overflow-auto">
              <div className="text-xs uppercase tracking-[0.2em] text-[#6E6E6E] mb-2">Source Nodes</div>
              <div className="pr-1">
                {markdownNotes.map(note => (
                  <SourceNoteCard key={note.id} note={note} selected={assemblyIdSet.has(note.id)} />
                ))}
                {markdownNotes.length === 0 && (
                  <div className="text-xs text-[#666] border border-dashed border-[#2B2B2B] rounded p-3">
                    没有可用的 Markdown 笔记。
                  </div>
                )}
              </div>
            </section>

            <section ref={setDropRef} className={`min-h-0 overflow-auto rounded ${isDropOver ? "bg-[#101010]" : ""}`}>
              <div className="text-xs uppercase tracking-[0.2em] text-[#6E6E6E] mb-2">Assembly Line</div>
              <SortableContext items={assemblyNotes.map(note => note.id)} strategy={verticalListSortingStrategy}>
                <div className="pr-1">
                  {assemblyNotes.map(note => (
                    <AssemblyNoteCard key={note.id} note={note} onRemove={handleRemoveAssemblyNote} />
                  ))}
                </div>
              </SortableContext>
              {assemblyNotes.length === 0 && (
                <div className="text-xs text-[#666] border border-dashed border-[#2B2B2B] rounded p-3">
                  拖入章节节点后即可编译。
                </div>
              )}
            </section>
          </div>
        </DndContext>
      </aside>

      <section className="flex-1 bg-[#111] flex items-center justify-center p-8">
        <div className="w-full h-full max-w-[1100px]">
          <PdfViewer
            pdfBytes={pdfBytes}
            placeholder={compiling ? "[ COMPILING... ]" : "PDF PREVIEW"}
          />
        </div>
      </section>
    </div>
  );
}
