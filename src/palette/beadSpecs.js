// Bead physical dimensions, sourced from CLAUDE.md's Bead Specs table.
// diameterMm/holeMm are verified against Miyuki's official size chart.
// heightMm is a provisional estimate (not yet caliper-verified) — see CLAUDE.md
// "Bead Specs" section for the known gap. Grid math reads these constants only,
// never hardcodes a dimension, so correcting heightMm later touches no grid code.

export const DELICA_11_0 = {
  name: 'Delica 11/0',
  diameterMm: 1.6, // verified — Miyuki official chart
  widthMm: 1.6, // verified — Miyuki official chart
  heightMm: 1.3, // provisional estimate, unverified
  holeMm: 0.8, // verified — Miyuki official chart
};

export const ROCAILLE_11_0 = {
  name: 'Round Rocaille 11/0',
  diameterMm: 2.0, // verified — Miyuki official chart
  widthMm: 2.0, // verified — Miyuki official chart
  heightMm: 1.4, // provisional estimate, unverified
  holeMm: 0.8, // verified — Miyuki official chart
};

export const BEAD_TYPES = {
  delica11: DELICA_11_0,
  rocaille11: ROCAILLE_11_0,
};
