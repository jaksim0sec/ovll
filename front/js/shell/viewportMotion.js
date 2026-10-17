/** UI interpolation policy: browser-visible bounds themselves are never delayed. */
export function decideViewportMotion({ previousHeight, height, elapsed, orientation = false }) {
  if (orientation) return 'immediate';
  const change = height - previousHeight;
  if (!Number.isFinite(change) || Math.abs(change) < 1.25) return 'stable';
  if (elapsed < 95) return 'tracking';
  return change < 0 ? 'shrinking' : 'growing';
}
