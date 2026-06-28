import { describe, it, expect } from "vitest";
import { itemDisplayText } from "./draw";
import { createItem } from "../model/panel";

describe("itemDisplayText", () => {
  it("Label shows its format literal", () => {
    const it = createItem("Label", { x: 0, y: 0 });
    it.format = "CPU";
    expect(itemDisplayText(it, NaN)).toBe("CPU");
  });
  it("SensorText formats the live value", () => {
    const it = createItem("SensorText", { x: 0, y: 0 });
    it.format = "%d °C";
    expect(itemDisplayText(it, 75.4)).toBe("75 °C");
  });
});
