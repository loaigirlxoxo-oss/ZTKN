import { DUMMY_SENSORS, dummyValue } from "./dummy";

export function startDummyLoop(onTick: (values: Map<string, number>) => void, intervalMs = 1000): () => void {
  const tick = () => {
    const now = performance.now();
    const m = new Map<string, number>();
    for (const s of DUMMY_SENSORS) m.set(s.id, dummyValue(s.id, now));
    onTick(m);
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
