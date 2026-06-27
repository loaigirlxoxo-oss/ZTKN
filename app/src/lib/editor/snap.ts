export function snap(value: number, grid: number): number {
  if (grid <= 1) return value;
  return Math.round(value / grid) * grid;
}
