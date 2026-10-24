const DB = 'quickmeet';
const STORE = 'assets';
const KEY = 'custom-background';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let cached: HTMLImageElement | null = null;
let cachedUrl: string | null = null;
let loadPromise: Promise<HTMLImageElement | null> | null = null;

export function getCustomBackgroundImage() {
  return cached;
}

export async function loadCustomBackground(): Promise<HTMLImageElement | null> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const db = await openDb();
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve((request.result as Blob | undefined) || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (!blob) return null;
      return await setCachedFromBlob(blob);
    } catch {
      return null;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function setCachedFromBlob(blob: Blob) {
  if (cachedUrl) URL.revokeObjectURL(cachedUrl);
  cachedUrl = URL.createObjectURL(blob);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load background image'));
    img.src = cachedUrl!;
  });
  cached = image;
  return image;
}

export async function saveCustomBackground(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
  if (file.size > 8 * 1024 * 1024) throw new Error('Keep the image under 8 MB');
  const bitmap = await createImageBitmap(file);
  const max = 1920;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(2, Math.round(bitmap.width * scale));
  const height = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error('Could not save image'))), 'image/jpeg', 0.88);
  });
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return setCachedFromBlob(blob);
}

export async function clearCustomBackground() {
  if (cachedUrl) URL.revokeObjectURL(cachedUrl);
  cached = null;
  cachedUrl = null;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
