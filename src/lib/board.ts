import { uid } from './code';

export type BoardPoint = { x: number; y: number; p?: number };

export type BoardTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'note'
  | 'image';

export type BoardObject = {
  id: string;
  clock: number;
  author: string;
  type: 'stroke' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'note' | 'image';
  color: string;
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
  x2?: number;
  y2?: number;
  points?: BoardPoint[];
  text?: string;
  noteColor?: string;
  src?: string;
  opacity?: number;
  deleted?: boolean;
};

export type BoardMeta = { hostOnly: boolean; clock: number };

export type BoardCursor = { id: string; name: string; color: string; x: number; y: number; ts: number };

export type BoardSnapshot = { objects: BoardObject[]; meta: BoardMeta };

export const BOARD_COLORS = ['#ffffff', '#111827', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
export const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff'];
export const STROKE_PX = [2.5, 4.5, 8];

export function emptyBoardMeta(): BoardMeta {
  return { hostOnly: false, clock: 0 };
}

export function mergeObject(current: BoardObject | undefined, incoming: BoardObject): BoardObject {
  if (!current) return incoming;
  if (incoming.clock > current.clock) return incoming;
  if (incoming.clock === current.clock && incoming.author > current.author) return incoming;
  return current;
}

export function mergeMeta(current: BoardMeta, incoming: BoardMeta): BoardMeta {
  if (incoming.clock > current.clock) return incoming;
  return current;
}

export function applySnapshot(objects: Map<string, BoardObject>, snapshot: BoardSnapshot) {
  for (const item of snapshot.objects) {
    objects.set(item.id, mergeObject(objects.get(item.id), item));
  }
}

export function visibleObjects(objects: Map<string, BoardObject>): BoardObject[] {
  return [...objects.values()].filter((item) => !item.deleted).sort((a, b) => a.clock - b.clock);
}

export function nextClock(local: number, seen: number) {
  return Math.max(local, seen) + 1;
}

export function strokeBounds(points: BoardPoint[], pad = 8): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function makeStroke(
  author: string,
  clock: number,
  points: BoardPoint[],
  color: string,
  size: number,
  opacity = 1,
): BoardObject {
  const box = strokeBounds(points);
  return {
    id: uid(),
    clock,
    author,
    type: 'stroke',
    color,
    size,
    opacity,
    points: points.map((point) => ({ ...point })),
    ...box,
  };
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

export function canResize(item: BoardObject) {
  return !item.deleted && (item.type === 'image' || item.type === 'note' || item.type === 'rect' || item.type === 'ellipse' || item.type === 'text');
}

export function handlePositions(item: BoardObject) {
  return {
    nw: { x: item.x, y: item.y },
    ne: { x: item.x + item.w, y: item.y },
    sw: { x: item.x, y: item.y + item.h },
    se: { x: item.x + item.w, y: item.y + item.h },
  } as const;
}

export function hitHandle(item: BoardObject, x: number, y: number, zoom: number): ResizeHandle | null {
  if (!canResize(item)) return null;
  const pad = Math.max(12, 16 / zoom);
  const handles = handlePositions(item);
  for (const key of ['se', 'sw', 'ne', 'nw'] as ResizeHandle[]) {
    if (Math.hypot(handles[key].x - x, handles[key].y - y) <= pad) return key;
  }
  return null;
}

export function cursorForHandle(handle: ResizeHandle | null) {
  if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return null;
}

export function resizeByHandle(
  item: BoardObject,
  handle: ResizeHandle,
  world: { x: number; y: number },
  keepAspect: boolean,
): BoardObject {
  const min = 32;
  const aspect = item.w / Math.max(1, item.h);
  const opposite = {
    nw: { x: item.x + item.w, y: item.y + item.h },
    ne: { x: item.x, y: item.y + item.h },
    sw: { x: item.x + item.w, y: item.y },
    se: { x: item.x, y: item.y },
  }[handle];
  let width = Math.abs(world.x - opposite.x);
  let height = Math.abs(world.y - opposite.y);
  if (keepAspect) {
    const fromWidth = width;
    const fromHeight = height * aspect;
    width = Math.max(fromWidth, fromHeight);
    height = width / aspect;
  }
  width = Math.max(min, width);
  height = Math.max(min, height);
  const x = handle.includes('w') ? opposite.x - width : opposite.x;
  const y = handle.includes('n') ? opposite.y - height : opposite.y;
  return { ...item, x, y, w: width, h: height };
}

export function hitObject(item: BoardObject, x: number, y: number, pad = 8): boolean {
  if (item.deleted) return false;
  if (item.type === 'stroke' && item.points) {
    for (const point of item.points) {
      if (Math.hypot(point.x - x, point.y - y) <= item.size + pad) return true;
    }
    return false;
  }
  if (item.type === 'line' || item.type === 'arrow') {
    return distToSegment(x, y, item.x, item.y, item.x2 ?? item.x, item.y2 ?? item.y) <= item.size + pad;
  }
  return x >= item.x - pad && y >= item.y - pad && x <= item.x + item.w + pad && y <= item.y + item.h + pad;
}

export function hitsBox(item: BoardObject, box: { x: number; y: number; w: number; h: number }): boolean {
  const left = Math.min(box.x, box.x + box.w);
  const top = Math.min(box.y, box.y + box.h);
  const right = Math.max(box.x, box.x + box.w);
  const bottom = Math.max(box.y, box.y + box.h);
  return item.x < right && item.x + item.w > left && item.y < bottom && item.y + item.h > top;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  if (!len) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function contentBounds(objects: BoardObject[]): { x: number; y: number; w: number; h: number } | null {
  const live = objects.filter((item) => !item.deleted);
  if (!live.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of live) {
    minX = Math.min(minX, item.x, item.x2 ?? item.x);
    minY = Math.min(minY, item.y, item.y2 ?? item.y);
    maxX = Math.max(maxX, item.x + item.w, item.x2 ?? item.x);
    maxY = Math.max(maxY, item.y + item.h, item.y2 ?? item.y);
  }
  return { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
}

export function drawStrokePath(ctx: CanvasRenderingContext2D, points: BoardPoint[], size: number) {
  if (!points.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const next = points[index + 1];
    ctx.quadraticCurveTo(points[index].x, points[index].y, (points[index].x + next.x) / 2, (points[index].y + next.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.lineWidth = size * (last.p && last.p > 0 ? 0.55 + last.p * 0.9 : 1);
  ctx.stroke();
}

export function drawInkStroke(
  ctx: CanvasRenderingContext2D,
  points: BoardPoint[],
  size: number,
  color: string,
  opacity = 1,
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  if (inkIsLight(color)) {
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#111827';
    drawStrokePath(ctx, points, size + 2.6);
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  drawStrokePath(ctx, points, size);
  ctx.restore();
}

function inkOutline(ctx: CanvasRenderingContext2D, color: string, size: number, paint: () => void) {
  if (inkIsLight(color)) {
    ctx.save();
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#111827';
    ctx.lineWidth = size + 2.6;
    paint();
    ctx.restore();
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  paint();
}

export function drawObject(ctx: CanvasRenderingContext2D, item: BoardObject) {
  if (item.deleted) return;
  ctx.save();
  if (item.type !== 'stroke') ctx.globalAlpha = item.opacity ?? 1;
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (item.type === 'stroke' && item.points) {
    drawInkStroke(ctx, item.points, item.size, item.color, item.opacity ?? 1);
  } else if (item.type === 'line' || item.type === 'arrow') {
    const x2 = item.x2 ?? item.x;
    const y2 = item.y2 ?? item.y;
    inkOutline(ctx, item.color, item.size, () => {
      ctx.beginPath();
      ctx.moveTo(item.x, item.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (item.type === 'arrow') drawArrowHead(ctx, item.x, item.y, x2, y2, item.size);
    });
  } else if (item.type === 'rect') {
    inkOutline(ctx, item.color, item.size, () => ctx.strokeRect(item.x, item.y, item.w, item.h));
  } else if (item.type === 'ellipse') {
    inkOutline(ctx, item.color, item.size, () => {
      ctx.beginPath();
      ctx.ellipse(item.x + item.w / 2, item.y + item.h / 2, Math.abs(item.w / 2), Math.abs(item.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  } else if (item.type === 'note') {
    ctx.fillStyle = item.noteColor || NOTE_COLORS[0];
    roundRect(ctx, item.x, item.y, item.w, item.h, 10);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.font = '500 14px Inter, Segoe UI, sans-serif';
    wrapText(ctx, item.text || '', item.x + 10, item.y + 24, item.w - 20, 18);
  } else if (item.type === 'text') {
    const size = Math.max(18, item.size * 5);
    ctx.font = `700 ${size}px Inter, Segoe UI, sans-serif`;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = inkIsLight(item.color) ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = Math.max(4, size / 8);
    ctx.fillStyle = item.color;
    wrapText(ctx, item.text || '', item.x, item.y + size, item.w || 320, size + 8, true);
  } else if (item.type === 'image' && item.src) {
    const cached = imageCache.get(item.src);
    if (cached) ctx.drawImage(cached, item.x, item.y, item.w, item.h);
    else {
      const image = new Image();
      image.onload = () => {
        imageCache.set(item.src!, image);
      };
      image.src = item.src;
    }
  }
  ctx.restore();
}

const imageCache = new Map<string, HTMLImageElement>();

export function preloadBoardImage(src: string, onReady?: () => void) {
  const cached = imageCache.get(src);
  if (cached) {
    onReady?.();
    return;
  }
  const image = new Image();
  image.onload = () => {
    imageCache.set(src, image);
    onReady?.();
  };
  image.src = src;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function inkIsLight(color: string) {
  const raw = color.replace('#', '').trim();
  const hex = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw.slice(0, 6);
  if (hex.length < 6) return false;
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return false;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.62;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  stroke = false,
) {
  const words = text.split(/\s+/);
  let line = '';
  let top = y;
  const paint = (value: string, left: number, baseline: number) => {
    if (stroke) ctx.strokeText(value, left, baseline);
    ctx.fillText(value, left, baseline);
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      paint(line, x, top);
      line = word;
      top += lineHeight;
    } else line = next;
  }
  if (line) paint(line, x, top);
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = 10 + size;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - len * Math.cos(angle - 0.4), y2 - len * Math.sin(angle - 0.4));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - len * Math.cos(angle + 0.4), y2 - len * Math.sin(angle + 0.4));
  ctx.stroke();
}

export function constrainShape(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  shift: boolean,
  kind: 'line' | 'arrow' | 'rect' | 'ellipse',
) {
  let x2 = endX;
  let y2 = endY;
  if (shift && (kind === 'line' || kind === 'arrow')) {
    const dx = endX - startX;
    const dy = endY - startY;
    if (Math.abs(dx) > Math.abs(dy) * 2) y2 = startY;
    else if (Math.abs(dy) > Math.abs(dx) * 2) x2 = startX;
    else {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      x2 = startX + Math.sign(dx || 1) * size;
      y2 = startY + Math.sign(dy || 1) * size;
    }
  }
  if (kind === 'rect' || kind === 'ellipse') {
    let w = x2 - startX;
    let h = y2 - startY;
    if (shift) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * size;
      h = Math.sign(h || 1) * size;
    }
    const x = w < 0 ? startX + w : startX;
    const y = h < 0 ? startY + h : startY;
    return { x, y, w: Math.abs(w), h: Math.abs(h), x2: x + Math.abs(w), y2: y + Math.abs(h) };
  }
  return {
    x: Math.min(startX, x2),
    y: Math.min(startY, y2),
    w: Math.abs(x2 - startX),
    h: Math.abs(y2 - startY),
    x2,
    y2,
  };
}

export async function resizeImageData(file: File | Blob): Promise<{ src: string; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { src: '', w, h };
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { src: canvas.toDataURL('image/jpeg', 0.82), w, h };
}

export function exportBoardPng(objects: BoardObject[]): Promise<Blob | null> {
  const bounds = contentBounds(objects) || { x: 0, y: 0, w: 1280, h: 720 };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(640, Math.ceil(bounds.w));
  canvas.height = Math.max(360, Math.ceil(bounds.h));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-bounds.x, -bounds.y);
  for (const item of objects) drawObject(ctx, item);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

export async function exportBoardPdf(objects: BoardObject[]): Promise<Blob | null> {
  const png = await exportBoardPng(objects);
  if (!png) return null;
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92));
  if (!jpeg) return null;
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const width = canvas.width;
  const height = canvas.height;
  const objectsTxt = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >> endobj`,
  ];
  const imgDict = `4 0 obj << /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >> stream\n`;
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const contentObj = `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`;
  const encoder = new TextEncoder();
  const header = encoder.encode('%PDF-1.4\n');
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let cursor = header.length;
  const pushText = (text: string) => {
    const chunk = encoder.encode(`${text}\n`);
    offsets.push(cursor);
    parts.push(chunk);
    cursor += chunk.length;
  };
  objectsTxt.forEach(pushText);
  offsets.push(cursor);
  const dictBytes = encoder.encode(imgDict);
  const endImg = encoder.encode('\nendstream endobj\n');
  parts.push(dictBytes, bytes, endImg);
  cursor += dictBytes.length + bytes.length + endImg.length;
  offsets.push(cursor);
  const contentBytes = encoder.encode(`${contentObj}\n`);
  parts.push(contentBytes);
  cursor += contentBytes.length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let index = 1; index <= 5; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  const xrefBytes = encoder.encode(xref);
  const trailer = encoder.encode(`trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`);
  parts.push(xrefBytes, trailer);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return new Blob([out], { type: 'application/pdf' });
}
