const palette = ['#0c6b4d', '#0b57d0', '#8a4b08', '#7a2e6b', '#0e6275', '#9a3412', '#3f4a8a'];

export function colorFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const text = parts.map((part) => part[0]?.toUpperCase() || '').join('');
  return text || '?';
}
