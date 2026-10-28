/** Single locale formatter: always render stored UTC/epoch as local "Oct 28, 10:00 AM". */
export function formatMeetingWhen(input: number | string | Date | null | undefined) {
  if (input == null || input === '') return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatMeetingDayKey(input: number | string | Date) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDurationLabel(ms: number, endedAt: number | null | undefined) {
  if (endedAt == null && !ms) return 'In progress';
  if (!ms && endedAt) return 'Ended';
  if (!ms) return 'In progress';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
