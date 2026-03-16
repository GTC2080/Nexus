import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizableOptions {
  /** 初始宽度 (px) */
  initialWidth: number;
  /** 最小宽度 (px) */
  minWidth: number;
  /** 最大宽度 (px) */
  maxWidth: number;
  /** 拖拽方向："left" 表示手柄在面板右侧（左侧面板），"right" 表示手柄在面板左侧（右侧面板） */
  side: "left" | "right";
}

export function useResizable({ initialWidth, minWidth, maxWidth, side }: UseResizableOptions) {
  const [width, setWidth] = useState(initialWidth);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      // 左侧面板：鼠标右移 → 宽度增大；右侧面板：鼠标左移 → 宽度增大
      const newWidth = side === "left"
        ? startWidth.current + delta
        : startWidth.current - delta;
      setWidth(Math.min(maxWidth, Math.max(minWidth, newWidth)));
    }

    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [minWidth, maxWidth, side]);

  return { width, handleMouseDown };
}
