export function valueToFraction(value: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0 || !Number.isFinite(value)) return 0;
  const f = (value - min) / span;
  return Math.max(0, Math.min(1, f));
}

export function valueToAngle(value: number, min: number, max: number, angleStart: number, angleEnd: number): number {
  const f = valueToFraction(value, min, max);
  return angleStart + (angleEnd - angleStart) * f;
}
