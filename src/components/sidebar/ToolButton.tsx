export default function ToolButton({ onClick, icon, label, shortcut }: {
  onClick: () => void; icon: React.ReactNode; label: string; shortcut: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-[7px] rounded-[10px] text-[13px]
        transition-all duration-150 cursor-pointer flex items-center gap-2.5
        hover:bg-white/[0.055] active:bg-white/[0.08]"
      style={{ color: "rgba(255,255,255,0.45)" }}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <kbd className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>{shortcut}</kbd>
    </button>
  );
}
