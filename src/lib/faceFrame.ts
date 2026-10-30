type Box = { x: number; y: number; zoom: number };

const ease = { x: 0.5, y: 0.34, zoom: 1 };
/** Face should take ~28% of the frame so headroom + chest/stomach stay in view. */
const FACE_SHARE = 0.28;
const MAX_BUST_ZOOM = 1.18;

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
    const faceMid = (box.y + box.height / 2) / Math.max(1, video.videoHeight);
    // Keep the face in the upper third so the crop runs down to the stomach.
    const cy = Math.min(0.4, Math.max(0.26, faceMid * 0.72 + 0.08));
    const zoom = Math.min(
      MAX_BUST_ZOOM,
      Math.max(1, (video.videoHeight * FACE_SHARE) / Math.max(48, box.height)),
    );
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
