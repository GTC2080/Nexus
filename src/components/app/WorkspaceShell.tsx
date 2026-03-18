import { useResizable } from "../../hooks/useResizable";
import { useSemanticResonance } from "../../hooks/useSemanticResonance";
import type { FileCategory, MolecularPreviewMeta, NoteInfo } from "../../types";
import type { RuntimeSettings } from "../settings/settingsTypes";
import ActivityBar from "../ActivityBar";
import Sidebar from "../Sidebar";
import ResizeHandle from "../ResizeHandle";
import EditorViewport from "./EditorViewport";
import AppStatusBar from "./AppStatusBar";

interface WorkspaceShellProps {
  vaultPath: string;
  notes: NoteInfo[];
  activeNote: NoteInfo | null;
  loading: boolean;
  error: string;
  activeCategory: FileCategory | null;
  noteContent: string;
  liveContent: string;
  molecularPreview: MolecularPreviewMeta | null;
  binaryPreviewUrl: string;
  runtimeSettings: RuntimeSettings;
  aiSidebarOpen: boolean;
  truthLevel: number;
  canOpenKinetics: boolean;
  kineticsOpen: boolean;
  onOpenSearch: () => void;
  onOpenGraph: () => void;
  onToggleAI: () => void;
  onOpenKinetics: () => void;
  onCloseKinetics: () => void;
  onCloseNote: () => void;
  onBackToManager: () => void;
  onOpenTruth: () => void;
  onOpenSettings: () => void;
  onSelectNote: (note: NoteInfo) => void | Promise<void>;
  onSave: (markdown: string) => void | Promise<void>;
  onLiveContentChange: (content: string) => void;
  onCreateFile: (kind: "note" | "canvas" | "timeline" | "paper", targetFolderRelativePath?: string) => void;
  onDeleteEntry: (absolutePath: string, targetLabel: string, isFolder: boolean) => void;
  onMoveEntry: (sourceRelativePath: string, destFolderRelativePath: string) => void;
  onRenameEntry: (sourceRelativePath: string, currentFullName: string, isFolder: boolean) => void;
  onInlineRenameEntry: (sourceRelativePath: string, newName: string) => void;
  onCreateFolder: (targetParentRelativePath?: string) => void;
}

export default function WorkspaceShell({
  vaultPath,
  notes,
  activeNote,
  loading,
  error,
  activeCategory,
  noteContent,
  liveContent,
  molecularPreview,
  binaryPreviewUrl,
  runtimeSettings,
  aiSidebarOpen,
  truthLevel,
  canOpenKinetics,
  kineticsOpen,
  onOpenSearch,
  onOpenGraph,
  onToggleAI,
  onOpenKinetics,
  onCloseKinetics,
  onCloseNote,
  onBackToManager,
  onOpenTruth,
  onOpenSettings,
  onSelectNote,
  onSave,
  onLiveContentChange,
  onCreateFile,
  onDeleteEntry,
  onMoveEntry,
  onRenameEntry,
  onInlineRenameEntry,
  onCreateFolder,
}: WorkspaceShellProps) {
  const { width: sidebarWidth, handleMouseDown: onSidebarDrag } = useResizable({
    initialWidth: 260,
    minWidth: 200,
    maxWidth: 480,
    side: "left",
  });
  const { width: rightWidth, handleMouseDown: onRightDrag } = useResizable({
    initialWidth: 320,
    minWidth: 240,
    maxWidth: 500,
    side: "right",
  });

  const { relatedNotes, loading: resonanceLoading } = useSemanticResonance(
    liveContent,
    activeNote?.id ?? null
  );

  return (
    <>
      <div className="flex flex-1 min-h-0">
        <ActivityBar
          onOpenSearch={onOpenSearch}
          onOpenGraph={onOpenGraph}
          onToggleAI={onToggleAI}
          onOpenKinetics={onOpenKinetics}
          onCreateCanvas={() => {
            void onCreateFile("canvas", "");
          }}
          onBackToManager={onBackToManager}
          canOpenKinetics={canOpenKinetics}
          kineticsOpen={kineticsOpen}
          activePanel="files"
        />

        <Sidebar
          vaultPath={vaultPath}
          notes={notes}
          activeNote={activeNote}
          loading={loading}
          width={sidebarWidth}
          onSelectNote={onSelectNote}
          onCreateFile={onCreateFile}
          onDeleteEntry={onDeleteEntry}
          onMoveEntry={onMoveEntry}
          onRenameEntry={onRenameEntry}
          onInlineRenameEntry={onInlineRenameEntry}
          onCreateFolder={onCreateFolder}
        />
        <ResizeHandle side="left" onMouseDown={onSidebarDrag} />

        <EditorViewport
          error={error}
          vaultPath={vaultPath}
          notes={notes}
          activeNote={activeNote}
          activeCategory={activeCategory}
          noteContent={noteContent}
          molecularPreview={molecularPreview}
          binaryPreviewUrl={binaryPreviewUrl}
          runtimeSettings={runtimeSettings}
          aiSidebarOpen={aiSidebarOpen}
          rightWidth={rightWidth}
          relatedNotes={relatedNotes}
          resonanceLoading={resonanceLoading}
          kineticsOpen={kineticsOpen}
          onRightResizeMouseDown={onRightDrag}
          onCloseKinetics={onCloseKinetics}
          onCloseNote={onCloseNote}
          onSave={onSave}
          onLiveContentChange={onLiveContentChange}
          onSelectNote={onSelectNote}
        />
      </div>

      <AppStatusBar
        vaultPath={vaultPath}
        truthLevel={truthLevel}
        onOpenTruth={onOpenTruth}
        onOpenSettings={onOpenSettings}
      />
    </>
  );
}
