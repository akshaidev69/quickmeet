type Box = { x: number; y: number; zoom: number };

const ease = { x: 0.5, y: 0.5, zoom: 1.15 };

export async function detectFaceCenter(video: HTMLVideoElement): Promise<Box | null> {
  const Detector = (
    window as Window & {
      FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
        detect: (input: HTMLVideoElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
      };
    }
  ).FaceDetector;
  if (!Detector || video.readyState < 2) return null;
  try {
    const detector = new Detector({ fastMode: true, maxDetectedFaces: 1 });
    const faces = await detector.detect(video);
    const box = faces[0]?.boundingBox;
    if (!box) return null;
    const cx = (box.x + box.width / 2) / Math.max(1, video.videoWidth);
    const cy = (box.y + box.height / 2) / Math.max(1, video.videoHeight);
    const zoom = Math.min(2, Math.max(1 + 8 / 100, (video.videoHeight * 0.72) / Math.max(48, box.height)));
    return { x: cx, y: cy, zoom };
  } catch {
    return null;
  }
}

export function tickFaceEase(target: Box | null, enabled: boolean, zoom: number) {
  const goal = enabled && target ? target : { x: 0.5, y: 0.5, zoom };
  ease.x += (goal.x - ease.x) * 0.12;
  ease.y += (goal.y - ease.y) * 0.12;
  ease.zoom += (goal.zoom - ease.zoom) * 0.1;
  return { x: ease.x, y: ease.y, zoom: ease.zoom };
}

export function faceObjectPosition(x: number, y: number) {
  return `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
}
