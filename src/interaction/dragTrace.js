// Fills in intermediate world-mm points between two pointermove samples so a fast
// drag doesn't skip cells — pointermove frequency is capped, and a bead can be a
// couple of screen pixels wide at low zoom, so consecutive raw samples can easily
// land two-or-more cells apart.
export function interpolatedWorldPoints(fromWorld, toWorld, stepMm) {
  const dx = toWorld.xMm - fromWorld.xMm;
  const dy = toWorld.yMm - fromWorld.yMm;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / stepMm));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({ xMm: fromWorld.xMm + dx * t, yMm: fromWorld.yMm + dy * t });
  }
  return points;
}
