// Display-layer-only mm <-> inch conversion (CLAUDE.md Decision #6).
// Internal state and grid math must never call these — only readouts do.

export const MM_PER_INCH = 25.4;

export function mmToInches(mm) {
  return mm / MM_PER_INCH;
}

export function inchesToMm(inches) {
  return inches * MM_PER_INCH;
}

export function formatLength(mm, unit, precision = 2) {
  const value = unit === 'in' ? mmToInches(mm) : mm;
  return `${value.toFixed(precision)} ${unit}`;
}
