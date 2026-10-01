import { describe, it, expect } from "vitest";
import { totalPowerIds, gpuPowerIsEstimated, GPU_POWER_ESTIMATED } from "./match";
import type { LiveSensor } from "./live.svelte";

const s = (hw: string, name: string, type = "Power"): LiveSensor =>
  ({ id: `${hw}|${name}|${type}`, name, hw, type, unit: "W" });
const CPU = s("Intel Core Ultra 7 265K", "CPU Package");
const NV_REAL = s("NVIDIA GeForce RTX 5080", "GPU Package");
const NV_EST = s("NVIDIA GeForce RTX 5080", GPU_POWER_ESTIMATED);

describe("totalPowerIds", () => {
  it("本物のGPU電力があれば推定より優先する", () => {
    const list = [CPU, NV_EST, NV_REAL];
    expect(totalPowerIds(list)).toEqual([CPU.id, NV_REAL.id]);
    expect(gpuPowerIsEstimated(list)).toBe(false);
  });

  it("ドライバが電力を返さない機種では推定値を足す", () => {
    const list = [CPU, NV_EST];
    expect(totalPowerIds(list)).toEqual([CPU.id, NV_EST.id]);
    expect(gpuPowerIsEstimated(list)).toBe(true);
  });

  it("GPUの電力がどちらも無ければCPUだけ", () => {
    expect(totalPowerIds([CPU])).toEqual([CPU.id]);
    expect(gpuPowerIsEstimated([CPU])).toBe(false);
  });
});
