/** Make MediaRecorder WebM seekable by injecting Duration into Segment Info. */

function readVint(view: DataView, offset: number) {
  if (offset >= view.byteLength) return null;
  const first = view.getUint8(offset);
  if (!first) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > view.byteLength) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i += 1) value = (value << 8) | view.getUint8(offset + i);
  return { value, length };
}

function writeVint(value: number) {
  if (value < 0x7f) return Uint8Array.of(0x80 | value);
  if (value < 0x3fff) return Uint8Array.of(0x40 | (value >> 8), value & 0xff);
  if (value < 0x1fffff) return Uint8Array.of(0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff);
  return Uint8Array.of(0x10 | (value >> 24), (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

function writeFloat64BE(value: number) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return new Uint8Array(buffer);
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function elementIdLength(byte: number) {
  if (byte & 0x80) return 1;
  if (byte & 0x40) return 2;
  if (byte & 0x20) return 3;
  if (byte & 0x10) return 4;
  return 1;
}

export async function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.size || durationMs <= 0) return blob;
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let infoHeader = -1;
  let infoStart = -1;
  let infoSize = 0;

  for (let i = 0; i + 12 < buffer.length; i += 1) {
    if (buffer[i] !== 0x18 || buffer[i + 1] !== 0x53 || buffer[i + 2] !== 0x80 || buffer[i + 3] !== 0x67) continue;
    const segSize = readVint(view, i + 4);
    if (!segSize) break;
    const segmentData = i + 4 + segSize.length;
    const unknown = segSize.length === 8 && buffer[i + 4] === 0x01;
    const end = unknown ? buffer.length : Math.min(buffer.length, segmentData + segSize.value);
    let p = segmentData;
    while (p + 6 < end) {
      if (buffer[p] === 0x15 && buffer[p + 1] === 0x49 && buffer[p + 2] === 0xa9 && buffer[p + 3] === 0x66) {
        const infoLen = readVint(view, p + 4);
        if (!infoLen) break;
        infoHeader = p;
        infoStart = p + 4 + infoLen.length;
        infoSize = infoLen.value;
        break;
      }
      const idLen = elementIdLength(buffer[p]);
      const elSize = readVint(view, p + idLen);
      if (!elSize) break;
      p += idLen + elSize.length + elSize.value;
    }
    break;
  }

  if (infoHeader < 0 || infoStart < 0) return blob;

  const infoBytes = buffer.subarray(infoStart, infoStart + infoSize);
  const infoView = new DataView(infoBytes.buffer, infoBytes.byteOffset, infoBytes.byteLength);
  const cleaned: Uint8Array[] = [];
  let q = 0;
  while (q < infoBytes.length) {
    const idLen = elementIdLength(infoBytes[q]);
    const elSize = readVint(infoView, q + idLen);
    if (!elSize) {
      cleaned.push(infoBytes.subarray(q));
      break;
    }
    const total = idLen + elSize.length + elSize.value;
    const isDuration = idLen === 2 && infoBytes[q] === 0x44 && infoBytes[q + 1] === 0x89;
    if (!isDuration) cleaned.push(infoBytes.subarray(q, q + total));
    q += total;
  }

  // Default TimecodeScale = 1_000_000 ns → Duration is milliseconds as float.
  const durationElement = concat([Uint8Array.of(0x44, 0x89), writeVint(8), writeFloat64BE(durationMs)]);
  const newInfo = concat([...cleaned, durationElement]);
  const rebuilt = concat([
    buffer.subarray(0, infoHeader),
    Uint8Array.of(0x15, 0x49, 0xa9, 0x66),
    writeVint(newInfo.length),
    newInfo,
    buffer.subarray(infoStart + infoSize),
  ]);
  return new Blob([rebuilt], { type: blob.type || 'video/webm' });
}
