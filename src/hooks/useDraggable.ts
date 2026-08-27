import { useState, useCallback, useEffect, useRef } from "react";

interface Position {
  x: number;
  y: number;
}

export function useDraggable(initialPosition: Position = { x: 0, y: 0 }) {
  const [position, setPosition] = useState<Position>(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  
  const dragStartPos = useRef<Position>({ x: 0, y: 0 });
  const elementStartPos = useRef<Position>({ x: 0, y: 0 });
  
  // Track if we've moved past the click threshold
  const hasMoved = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only left clicks, and ignore clicks on inputs/buttons
    if (e.button !== 0) return;
    
    const target = e.target as HTMLElement;
    if (
      target.tagName.toLowerCase() === "input" || 
      target.tagName.toLowerCase() === "button" ||
      target.closest("button")
    ) {
      return;
    }
    
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}
    
    setIsDragging(true);
    hasMoved.current = false;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    elementStartPos.current = { ...position };
  }, [position]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging) return;
    
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    
    // Drag threshold to differentiate between a click and a drag
    if (!hasMoved.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      hasMoved.current = true;
    }
    
    if (hasMoved.current) {
      setPosition({
        x: elementStartPos.current.x + dx,
        y: elementStartPos.current.y + dy,
      });
    }
  }, [isDragging]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    
    try {
      // Release capture if it was set
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointerId is no longer valid
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    }
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isDragging, handlePointerMove, handlePointerUp]);

  return {
    position,
    isDragging,
    /** Returns true if the pointer moved past the drag threshold during the current/last interaction */
    hasMoved: () => hasMoved.current,
    dragProps: {
      onPointerDown: handlePointerDown,
      style: {
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: isDragging ? "grabbing" : undefined,
        touchAction: "none" // Prevent scrolling on touch devices while dragging
      }
    }
  };
}
