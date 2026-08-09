// crypto.randomUUID() only exists in a secure context (HTTPS, or the special-cased
// 'localhost') — testing over LAN via the Mac's IP (CLAUDE.md's iPad testing
// approach since Phase 2) is plain HTTP, so it's undefined there. getRandomValues
// has no such restriction, so build a UUID v4 on top of it instead.
export function generateId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
