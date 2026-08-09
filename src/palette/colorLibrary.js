// Placeholder color swatches, NOT a verified Miyuki catalog (see CLAUDE.md's Bead
// Specs gap note and the Phase 2 plan's "Open question"). Structured so swapping in
// real Miyuki DB/RR color numbers later is a data-only change — nothing that reads
// these arrays needs to know or care whether an entry is provisional or catalog-real.
// Keyed the same way as BEAD_TYPES so callers look both up identically.

const PLACEHOLDER_SWATCHES = [
  { id: 'black', name: 'Black', hex: '#1a1a1a' },
  { id: 'white', name: 'White', hex: '#f5f5f0' },
  { id: 'red', name: 'Red', hex: '#c0392b' },
  { id: 'orange', name: 'Orange', hex: '#e67e22' },
  { id: 'yellow', name: 'Yellow', hex: '#f1c40f' },
  { id: 'lime', name: 'Lime', hex: '#a9d13a' },
  { id: 'green', name: 'Green', hex: '#27ae60' },
  { id: 'teal', name: 'Teal', hex: '#16a085' },
  { id: 'sky', name: 'Sky', hex: '#3498db' },
  { id: 'blue', name: 'Blue', hex: '#2c3e50' },
  { id: 'purple', name: 'Purple', hex: '#8e44ad' },
  { id: 'pink', name: 'Pink', hex: '#e91e8c' },
  { id: 'brown', name: 'Brown', hex: '#7a5230' },
  { id: 'silver', name: 'Silver', hex: '#bdc3c7' },
  { id: 'gold', name: 'Gold', hex: '#c9a227' },
  { id: 'gray', name: 'Gray', hex: '#7f8c8d' },
];

export const COLOR_LIBRARIES = {
  delica11: PLACEHOLDER_SWATCHES,
  rocaille11: PLACEHOLDER_SWATCHES,
};
