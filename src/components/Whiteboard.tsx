import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  BOARD_COLORS,
  NOTE_COLORS,
  STROKE_PX,
  canResize,
  constrainShape,
  contentBounds,
  cursorForHandle,
  drawObject,
  drawInkStroke,
  exportBoardPdf,
  exportBoardPng,
  handlePositions,
  hitHandle,
  hitObject,
  hitsBox,
  inkIsLight,
  makeStroke,
  preloadBoardImage,
  resizeByHandle,
  resizeImageData,
  type BoardCursor,
  type BoardMeta,
  type BoardObject,
  type BoardPoint,
  type BoardTool,
  type ResizeHandle,
} from '../lib/board';
import { uid } from '../lib/code';

type LiveStroke = { id: string; points: BoardPoint[]; color: string; size: number; opacity?: number };

type Props = {
  myId: string;
  name: string;
  isHost: boolean;
  objects: BoardObject[];
  meta: BoardMeta;
  cursors: BoardCursor[];
  live: LiveStroke[];
  filmstrip: ReactNode;
  canDraw: boolean;
  onOp: (object: BoardObject) => void;
  onLive: (stroke: LiveStroke & { done?: boolean }) => void;
  onCursor: (x: number, y: number) => void;
  onMeta: (meta: BoardMeta) => void;
  onSave: (blob: Blob) => void;
  onClose: () => void;
};

type Camera = { x: number; y: number; zoom: number };

const TOOLS: Array<{ id: BoardTool; label: string; icon: string }> = [
  { id: 'select', label: 'Select', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { id: 'pen', label: 'Pen', icon: 'M4 20l4-1 11-11-3-3L5 16l-1 4z' },
  { id: 'highlighter', label: 'Highlighter', icon: 'M4 20h16M7 16l8-8 3 3-8 8H7z' },
  { id: 'eraser', label: 'Eraser', icon: 'M4 16l8-8 6 6-8 8H6l-2-2z' },
  { id: 'line', label: 'Line', icon: 'M5 19L19 5' },
  { id: 'arrow', label: 'Arrow', icon: 'M5 19L19 5M13 5h6v6' },
  { id: 'rect', label: 'Rectangle', icon: 'M5 6h14v12H5z' },
  { id: 'ellipse', label: 'Circle', icon: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14z' },
  { id: 'text', label: 'Text', icon: 'M5 6h14M12 6v14' },
  { id: 'note', label: 'Sticky note', icon: 'M6 5h9l5 5v9H6zM15 5v5h5' },
  { id: 'image', label: 'Image', icon: 'M4 6h16v12H4zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 16l4-4 3 3 3-4 4 5' },
];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function worldOf(camera: Camera, clientX: number, clientY: number, rect: DOMRect) {
  return {
    x: (clientX - rect.left - camera.x) / camera.zoom,
    y: (clientY - rect.top - camera.y) / camera.zoom,
  };
}

export function Whiteboard({
  myId,
  name,
  isHost,
  objects,
  meta,
  cursors,
  live,
  filmstrip,
  canDraw,
  onOp,
  onLive,
  onCursor,
  onMeta,
  onSave,
  onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ x: 40, y: 40, zoom: 1 });
  const [camera, setCamera] = useState<Camera>(cameraRef.current);
  const [tool, setTool] = useState<BoardTool>('pen');
  const [color, setColor] = useState('#111827');
  const [customColor, setCustomColor] = useState('#7c3aed');
  const [sizeIndex, setSizeIndex] = useState(1);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  const [hiddenBar, setHiddenBar] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [eraseArea, setEraseArea] = useState(false);
  const [textDraft, setTextDraft] = useState<{ id: string; x: number; y: number; text: string; note?: boolean } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [space, setSpace] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const placingRef = useRef(false);
  const dragNow = useRef<{ x: number; y: number } | null>(null);
  const imageAt = useRef({ x: 80, y: 80 });
  const textDraftRef = useRef(textDraft);
  textDraftRef.current = textDraft;
  const undoRef = useRef<BoardObject[][]>([]);
  const redoRef = useRef<BoardObject[][]>([]);
  const clockRef = useRef(1);
  const drawing = useRef(false);
  const pointsRef = useRef<BoardPoint[]>([]);
  const liveIdRef = useRef('');
  const startRef = useRef({ x: 0, y: 0 });
  const lastLive = useRef(0);
  const marquee = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const moveRef = useRef<{ ids: string[]; ox: number; oy: number; originals: BoardObject[] } | null>(null);
  const resizeRef = useRef<{ id: string; handle: ResizeHandle; original: BoardObject } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; cx: number; cy: number } | null>(null);
  const dirty = useRef(true);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const liveRef = useRef(live);
  liveRef.current = live;
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const size = STROKE_PX[sizeIndex] || 4.5;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const bumpClock = () => {
    const seen = Math.max(clockRef.current, meta.clock, ...objectsRef.current.map((item) => item.clock));
    clockRef.current = seen + 1;
    return clockRef.current;
  };

  const commit = useCallback(
    (next: BoardObject[], record = true) => {
      if (record) {
        undoRef.current.push(next.map((item) => ({ ...item })));
        redoRef.current = [];
        if (undoRef.current.length > 80) undoRef.current.shift();
      }
      next.forEach(onOp);
    },
    [onOp],
  );

  const fitContent = useCallback(() => {
    const wrap = wrapRef.current;
    const bounds = contentBounds(objectsRef.current);
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!bounds) {
      const next = { x: 40, y: 40, zoom: 1 };
      cameraRef.current = next;
      setCamera(next);
      return;
    }
    const zoom = Math.max(0.25, Math.min(2.4, Math.min((w - 48) / bounds.w, (h - 48) / bounds.h)));
    const next = {
      zoom,
      x: (w - bounds.w * zoom) / 2 - bounds.x * zoom,
      y: (h - bounds.h * zoom) / 2 - bounds.y * zoom,
    };
    cameraRef.current = next;
    setCamera(next);
    dirty.current = true;
  }, []);

  useEffect(() => {
    objects.forEach((item) => {
      if (item.type === 'image' && item.src) preloadBoardImage(item.src, () => { dirty.current = true; });
    });
    dirty.current = true;
  }, [objects, live, cursors, camera, selected, textDraft]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const paint = () => {
      frame = requestAnimationFrame(paint);
      if (!dirty.current) return;
      dirty.current = false;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      const cam = cameraRef.current;
      ctx.save();
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      for (const item of objectsRef.current) drawObject(ctx, item);
      for (const stroke of liveRef.current) {
        drawInkStroke(ctx, stroke.points, stroke.size, stroke.color, stroke.opacity ?? 1);
      }
      if (pointsRef.current.length) {
        drawInkStroke(
          ctx,
          pointsRef.current,
          sizeRef.current,
          colorRef.current,
          toolRef.current === 'highlighter' ? 0.35 : 1,
        );
      }
      if (dragNow.current && (toolRef.current === 'line' || toolRef.current === 'arrow' || toolRef.current === 'rect' || toolRef.current === 'ellipse')) {
        const shape = constrainShape(
          startRef.current.x,
          startRef.current.y,
          dragNow.current.x,
          dragNow.current.y,
          false,
          toolRef.current,
        );
        drawObject(ctx, {
          id: 'preview',
          clock: 0,
          author: myId,
          type: toolRef.current,
          color: colorRef.current,
          size: sizeRef.current,
          opacity: 0.7,
          ...shape,
        });
      }
      if (marquee.current) {
        ctx.save();
        ctx.strokeStyle = '#1e88e5';
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(marquee.current.x, marquee.current.y, marquee.current.w, marquee.current.h);
        ctx.restore();
      }
      if (selectedRef.current.length) {
        ctx.save();
        ctx.strokeStyle = '#1e88e5';
        ctx.lineWidth = 1.5 / cam.zoom;
        const handleSize = 8 / cam.zoom;
        for (const id of selectedRef.current) {
          const item = objectsRef.current.find((entry) => entry.id === id);
          if (!item) continue;
          ctx.setLineDash([]);
          ctx.strokeRect(item.x - 4, item.y - 4, item.w + 8, item.h + 8);
          if (!canResize(item)) continue;
          const handles = handlePositions(item);
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#1e88e5';
          ctx.lineWidth = 1.5 / cam.zoom;
          for (const point of Object.values(handles)) {
            ctx.fillRect(point.x - handleSize, point.y - handleSize, handleSize * 2, handleSize * 2);
            ctx.strokeRect(point.x - handleSize, point.y - handleSize, handleSize * 2, handleSize * 2);
          }
        }
        ctx.restore();
      }
      ctx.restore();
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable);
      if (typing) return;
      if (event.code === 'Space') {
        setSpace(event.type === 'keydown');
        event.preventDefault();
      }
      if (event.type !== 'keydown') return;
      const cmd = event.metaKey || event.ctrlKey;
      if (cmd && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (textDraftRef.current) flushText();
        else if (confirmClear) setConfirmClear(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [confirmClear, onClose]);

  useEffect(() => {
    if (!textDraft) return;
    const timer = window.setTimeout(() => {
      placingRef.current = false;
      textRef.current?.focus();
    }, 40);
    return () => clearTimeout(timer);
  }, [textDraft?.id]);

  function undo() {
    const last = undoRef.current.pop();
    if (!last) return;
    redoRef.current.push(last);
    last.forEach((item) => onOp({ ...item, clock: bumpClock(), deleted: true }));
    dirty.current = true;
  }

  function redo() {
    const last = redoRef.current.pop();
    if (!last) return;
    last.forEach((item) => onOp({ ...item, clock: bumpClock(), deleted: false }));
    undoRef.current.push(last);
    dirty.current = true;
  }

  function deleteSelected() {
    if (!canDraw || !selected.length) return;
    const victims = objects.filter((item) => selected.includes(item.id));
    commit(victims.map((item) => ({ ...item, clock: bumpClock(), deleted: true })));
    setSelected([]);
  }

  function flushText(raw?: string) {
    const draft = textDraftRef.current;
    if (!draft) return;
    if (placingRef.current) {
      textRef.current?.focus();
      return;
    }
    const text = (raw ?? textRef.current?.value ?? draft.text).trim() || (draft.note ? name : '');
    if (!text) {
      setTextDraft(null);
      return;
    }
    commit([
      {
        id: draft.id,
        clock: bumpClock(),
        author: myId,
        type: draft.note ? 'note' : 'text',
        color: draft.note ? '#1f2937' : colorRef.current,
        size: sizeRef.current,
        x: draft.x,
        y: draft.y,
        w: draft.note ? 180 : Math.max(280, text.length * 14),
        h: draft.note ? 140 : Math.max(56, Math.ceil(text.length / 24) * 28),
        text,
        noteColor: draft.note ? noteColor : undefined,
      },
    ]);
    setTextDraft(null);
  }

  function emitLive(done = false) {
    const now = performance.now();
    if (!done && now - lastLive.current < 33) return;
    lastLive.current = now;
    onLive({
      id: liveIdRef.current,
      points: pointsRef.current.map((point) => ({ ...point })),
      color,
      size,
      opacity: tool === 'highlighter' ? 0.35 : 1,
      done,
    });
  }

  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const cam = cameraRef.current;
    const world = worldOf(cam, event.clientX, event.clientY, rect);
    const nextZoom = Math.max(0.25, Math.min(3, cam.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    const next = {
      zoom: nextZoom,
      x: event.clientX - rect.left - world.x * nextZoom,
      y: event.clientY - rect.top - world.y * nextZoom,
    };
    cameraRef.current = next;
    setCamera(next);
    dirty.current = true;
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const world = worldOf(cameraRef.current, event.clientX, event.clientY, rect);
    onCursor(world.x, world.y);
    startRef.current = world;
    if (tool === 'text' || tool === 'note') {
      if (!canDraw) return;
      placingRef.current = false;
      if (textDraftRef.current) flushText(textRef.current?.value);
      placingRef.current = true;
      const hit = [...objectsRef.current].reverse().find((item) => hitObject(item, world.x, world.y) && (item.type === 'text' || item.type === 'note'));
      setTextDraft(
        hit
          ? { id: hit.id, x: hit.x, y: hit.y, text: hit.text || '', note: hit.type === 'note' }
          : { id: uid(), x: world.x, y: world.y, text: '', note: tool === 'note' },
      );
      return;
    }
    if (tool === 'image') {
      if (!canDraw) return;
      const existing = [...objectsRef.current].reverse().find((item) => item.type === 'image' && hitObject(item, world.x, world.y));
      if (existing) {
        setTool('select');
        setSelected([existing.id]);
        const handle = hitHandle(existing, world.x, world.y, cameraRef.current.zoom);
        if (handle) {
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = { id: existing.id, handle, original: { ...existing } };
          drawing.current = true;
        }
        return;
      }
      imageAt.current = world;
      fileRef.current?.click();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        zoom: cameraRef.current.zoom,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      };
      drawing.current = false;
      return;
    }
    if (space || event.button === 1) {
      drawing.current = true;
      moveRef.current = { ids: [], ox: event.clientX, oy: event.clientY, originals: [] };
      return;
    }
    if (!canDraw) return;
    setHiddenBar(true);
    if (tool === 'select') {
      const selectedItem = selected.length === 1 ? objects.find((item) => item.id === selected[0]) : undefined;
      const handleOnSelected = selectedItem ? hitHandle(selectedItem, world.x, world.y, cameraRef.current.zoom) : null;
      if (selectedItem && handleOnSelected) {
        resizeRef.current = { id: selectedItem.id, handle: handleOnSelected, original: { ...selectedItem } };
        drawing.current = true;
        return;
      }
      const hit = [...objects].reverse().find((item) => hitObject(item, world.x, world.y) || Boolean(hitHandle(item, world.x, world.y, cameraRef.current.zoom)));
      if (hit) {
        if (event.detail === 2 && (hit.type === 'text' || hit.type === 'note')) {
          placingRef.current = true;
          setTextDraft({ id: hit.id, x: hit.x, y: hit.y, text: hit.text || '', note: hit.type === 'note' });
          return;
        }
        const handle = hitHandle(hit, world.x, world.y, cameraRef.current.zoom);
        setSelected([hit.id]);
        if (handle) {
          resizeRef.current = { id: hit.id, handle, original: { ...hit } };
          drawing.current = true;
          return;
        }
        const ids = selected.includes(hit.id) ? selected : [hit.id];
        setSelected(ids);
        moveRef.current = {
          ids,
          ox: world.x,
          oy: world.y,
          originals: objects.filter((item) => ids.includes(item.id)).map((item) => ({ ...item })),
        };
      } else {
        setSelected([]);
        marquee.current = { x: world.x, y: world.y, w: 0, h: 0 };
      }
      drawing.current = true;
      return;
    }
    if (tool === 'eraser') {
      drawing.current = true;
      eraseAt(world.x, world.y);
      return;
    }
    drawing.current = true;
    dragNow.current = world;
    if (tool === 'pen' || tool === 'highlighter') {
      liveIdRef.current = uid();
      pointsRef.current = [{ x: world.x, y: world.y, p: event.pressure || 0.5 }];
      dirty.current = true;
      emitLive();
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const scale = dist / Math.max(1, pinch.current.dist);
      const nextZoom = Math.max(0.25, Math.min(3, pinch.current.zoom * scale));
      const rect = wrap.getBoundingClientRect();
      const cam = cameraRef.current;
      const world = worldOf(cam, pinch.current.cx, pinch.current.cy, rect);
      const next = {
        zoom: nextZoom,
        x: pinch.current.cx - rect.left - world.x * nextZoom,
        y: pinch.current.cy - rect.top - world.y * nextZoom,
      };
      cameraRef.current = next;
      setCamera(next);
      dirty.current = true;
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const world = worldOf(cameraRef.current, event.clientX, event.clientY, rect);
    onCursor(world.x, world.y);
    if (!drawing.current) {
      const hoverItem =
        (selected.length === 1 && objects.find((item) => item.id === selected[0])) ||
        [...objects].reverse().find((item) => canResize(item) && hitObject(item, world.x, world.y));
      const handle = hoverItem ? hitHandle(hoverItem, world.x, world.y, cameraRef.current.zoom) : null;
      event.currentTarget.style.cursor = cursorForHandle(handle) || '';
      return;
    }
    if (space || (moveRef.current && moveRef.current.ids.length === 0 && tool !== 'select')) {
      const cam = cameraRef.current;
      const next = { ...cam, x: cam.x + event.movementX, y: cam.y + event.movementY };
      cameraRef.current = next;
      setCamera(next);
      dirty.current = true;
      return;
    }
    if (resizeRef.current) {
      const original = resizeRef.current.original;
      const keepAspect = original.type === 'image' ? !event.shiftKey : event.shiftKey;
      onOp({
        ...resizeByHandle(original, resizeRef.current.handle, world, keepAspect),
        clock: bumpClock(),
      });
      dirty.current = true;
      return;
    }
    if (tool === 'select' && marquee.current) {
      marquee.current = {
        x: startRef.current.x,
        y: startRef.current.y,
        w: world.x - startRef.current.x,
        h: world.y - startRef.current.y,
      };
      dirty.current = true;
      return;
    }
    if (tool === 'select' && moveRef.current?.ids.length) {
      const dx = world.x - moveRef.current.ox;
      const dy = world.y - moveRef.current.oy;
      moveRef.current.originals.forEach((item) => {
        onOp({
          ...item,
          clock: bumpClock(),
          x: item.x + dx,
          y: item.y + dy,
          x2: item.x2 != null ? item.x2 + dx : undefined,
          y2: item.y2 != null ? item.y2 + dy : undefined,
          points: item.points?.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
        });
      });
      dirty.current = true;
      return;
    }
    if (tool === 'eraser') {
      eraseAt(world.x, world.y);
      return;
    }
    if (tool === 'pen' || tool === 'highlighter') {
      pointsRef.current.push({ x: world.x, y: world.y, p: event.pressure || 0.5 });
      emitLive();
      dirty.current = true;
    } else if (tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse') {
      dragNow.current = world;
      dirty.current = true;
    } else {
      dirty.current = true;
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    setHiddenBar(false);
    const wrap = wrapRef.current;
    if (!wrap) {
      drawing.current = false;
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const world = worldOf(cameraRef.current, event.clientX, event.clientY, rect);
    if (tool === 'select' && marquee.current) {
      const box = marquee.current;
      setSelected(objects.filter((item) => hitsBox(item, box)).map((item) => item.id));
      marquee.current = null;
    }
    if ((tool === 'pen' || tool === 'highlighter') && pointsRef.current.length) {
      const stroke = makeStroke(myId, bumpClock(), pointsRef.current, color, size, tool === 'highlighter' ? 0.35 : 1);
      stroke.id = liveIdRef.current || stroke.id;
      commit([stroke]);
      emitLive(true);
      pointsRef.current = [];
    }
    if (tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse') {
      const shape = constrainShape(startRef.current.x, startRef.current.y, world.x, world.y, event.shiftKey, tool);
      if (Math.hypot(shape.w, shape.h) > 4) {
        commit([
          {
            id: uid(),
            clock: bumpClock(),
            author: myId,
            type: tool,
            color,
            size,
            ...shape,
          },
        ]);
      }
    }
    dragNow.current = null;
    drawing.current = false;
    moveRef.current = null;
    resizeRef.current = null;
    dirty.current = true;
  }

  function eraseAt(x: number, y: number) {
    const radius = eraseArea ? size * 10 : size + 8;
    const hits = objects.filter((item) => {
      if (eraseArea) {
        return hitsBox(item, { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 });
      }
      return hitObject(item, x, y, radius);
    });
    if (!hits.length) return;
    commit(hits.map((item) => ({ ...item, clock: bumpClock(), deleted: true })));
  }

  async function addImage(file: File | Blob, x = 80, y = 80) {
    if (!canDraw) return;
    const image = await resizeImageData(file);
    if (!image.src) return;
    preloadBoardImage(image.src);
    const wrap = wrapRef.current;
    const maxW = Math.min(420, Math.max(180, (wrap?.clientWidth || 640) * 0.45));
    const scale = Math.min(1, maxW / image.w);
    const id = uid();
    commit([
      {
        id,
        clock: bumpClock(),
        author: myId,
        type: 'image',
        color,
        size,
        x,
        y,
        w: Math.max(32, image.w * scale),
        h: Math.max(32, image.h * scale),
        src: image.src,
      },
    ]);
    setSelected([id]);
    setTool('select');
    dirty.current = true;
  }

  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const wrap = wrapRef.current?.getBoundingClientRect();
      const world = wrap ? worldOf(cameraRef.current, event.clientX, event.clientY, wrap) : { x: 80, y: 80 };
      await addImage(file, world.x, world.y);
    }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable);
      if (typing) return;
      const file = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'))?.getAsFile();
      if (file) void addImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canDraw, color, myId, size]);

  async function exportPng() {
    const blob = await exportBoardPng(objects);
    if (blob) download(blob, `letsconnect-board.png`);
  }

  async function exportPdf() {
    const blob = await exportBoardPdf(objects);
    if (blob) download(blob, `letsconnect-board.pdf`);
  }

  async function saveToMeeting() {
    const blob = await exportBoardPng(objects);
    if (blob) onSave(blob);
  }

  const bounds = contentBounds(objects);
  const minimap = bounds
    ? {
        x: ((0 - camera.x) / camera.zoom - bounds.x) / bounds.w,
        y: ((0 - camera.y) / camera.zoom - bounds.y) / bounds.h,
      }
    : null;

  return (
    <div className="wb-root" data-hide-tools={hiddenBar ? '1' : '0'}>
      <div className="wb-filmstrip" aria-label="People on the board">
        {filmstrip}
      </div>
      <div
        className="wb-canvas-wrap"
        ref={wrapRef}
        onWheel={onWheel}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDrop(event)}
      >
        <canvas
          ref={canvasRef}
          className="wb-canvas"
          data-tool={tool}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="wb-file"
          aria-label="Add image"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void addImage(file, imageAt.current.x, imageAt.current.y);
          }}
        />
        {cursors.map((cursor) => {
          if (cursor.id === myId) return null;
          return (
            <div
              key={cursor.id}
              className="wb-cursor"
              style={{
                left: cursor.x * camera.zoom + camera.x,
                top: cursor.y * camera.zoom + camera.y,
                ['--wb-cursor' as string]: cursor.color,
              }}
            >
              <i />
              <span>{cursor.name}</span>
            </div>
          );
        })}
        {textDraft && (
          <textarea
            ref={textRef}
            className="wb-text"
            value={textDraft.text}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            style={{
              left: textDraft.x * camera.zoom + camera.x,
              top: textDraft.y * camera.zoom + camera.y,
              ['--wb-ink' as string]: textDraft.note ? '#1f2937' : color,
              color: textDraft.note ? '#1f2937' : color,
              caretColor: textDraft.note ? '#1f2937' : color,
              background: textDraft.note
                ? noteColor
                : inkIsLight(color)
                  ? 'rgba(17, 24, 39, 0.92)'
                  : 'rgba(255, 255, 255, 0.96)',
            }}
            onChange={(event) => setTextDraft({ ...textDraft, text: event.target.value })}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
              if (placingRef.current) {
                event.target.focus();
                return;
              }
              flushText(event.target.value);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                flushText(event.currentTarget.value);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                flushText(event.currentTarget.value);
              }
            }}
            placeholder={textDraft.note ? 'Sticky note' : 'Type here'}
          />
        )}
        <div className="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tool === item.id ? 'on' : undefined}
              title={item.label}
              aria-label={item.label}
              disabled={!canDraw && item.id !== 'select'}
              onClick={() => {
                setTool(item.id);
                if (item.id === 'image') {
                  imageAt.current = { x: 80, y: 80 };
                  fileRef.current?.click();
                }
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={item.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
          <span className="wb-sep" />
          {BOARD_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`swatch${color === swatch ? ' on' : ''}${swatch === '#ffffff' ? ' is-white' : ''}`}
              style={{ background: swatch }}
              title={swatch === '#ffffff' ? 'White' : swatch === '#111827' ? 'Black' : 'Color'}
              aria-label={swatch === '#ffffff' ? 'White' : `Color ${swatch}`}
              onClick={() => setColor(swatch)}
            />
          ))}
          <label className="wb-custom" title="Custom color">
            <input type="color" value={customColor} onChange={(event) => { setCustomColor(event.target.value); setColor(event.target.value); }} />
          </label>
          <span className="wb-sep" />
          {STROKE_PX.map((px, index) => (
            <button
              key={px}
              type="button"
              className={sizeIndex === index ? 'on' : undefined}
              title={index === 0 ? 'Thin' : index === 1 ? 'Medium' : 'Thick'}
              onClick={() => setSizeIndex(index)}
            >
              <i className={`wb-dot s${index}`} />
            </button>
          ))}
          {tool === 'note' && (
            <span className="wb-notes">
              {NOTE_COLORS.map((swatch) => (
                <button key={swatch} type="button" className={noteColor === swatch ? 'swatch on' : 'swatch'} style={{ background: swatch }} onClick={() => setNoteColor(swatch)} />
              ))}
            </span>
          )}
          {tool === 'eraser' && (
            <button type="button" className={eraseArea ? 'on' : undefined} onClick={() => setEraseArea((value) => !value)} title="Area eraser">
              Area
            </button>
          )}
        </div>
        <div className="wb-side">
          <button type="button" onClick={fitContent} title="Fit to content">
            Fit
          </button>
          <button type="button" onClick={undo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" onClick={redo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button type="button" onClick={() => void exportPng()}>
            PNG
          </button>
          <button type="button" onClick={() => void exportPdf()}>
            PDF
          </button>
          <button type="button" onClick={() => void saveToMeeting()}>
            Save
          </button>
          {isHost && (
            <>
              <button type="button" className={meta.hostOnly ? 'on' : undefined} onClick={() => onMeta({ hostOnly: !meta.hostOnly, clock: bumpClock() })}>
                {meta.hostOnly ? 'Host only' : 'Everyone'}
              </button>
              <button type="button" className="danger" onClick={() => setConfirmClear(true)}>
                Clear
              </button>
            </>
          )}
          <button type="button" className="wb-close" onClick={onClose}>
            Close
          </button>
        </div>
        {minimap && bounds && (
          <div className="wb-minimap" aria-hidden="true">
            <b style={{ left: `${Math.max(0, Math.min(90, minimap.x * 100))}%`, top: `${Math.max(0, Math.min(90, minimap.y * 100))}%` }} />
          </div>
        )}
        {!canDraw && <p className="wb-lock">Only the host can draw right now</p>}
        {confirmClear && (
          <div className="wb-confirm-scrim">
            <div className="wb-confirm" role="dialog" aria-labelledby="wb-clear-title" aria-modal="true">
              <p id="wb-clear-title">Clear the whole board for everyone?</p>
              <div className="wb-confirm-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    commit(objects.map((item) => ({ ...item, clock: bumpClock(), deleted: true })));
                    setSelected([]);
                    setConfirmClear(false);
                  }}
                >
                  Clear board
                </button>
                <button type="button" className="wb-confirm-cancel" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
