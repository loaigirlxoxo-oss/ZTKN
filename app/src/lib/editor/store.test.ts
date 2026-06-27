import { describe, it, expect } from "vitest";
import { serializePanel, deserializePanel } from "./store";
import { createPanel, createItem } from "../model/panel";

describe("panel serialization", () => {
  it("round-trips a panel through JSON", () => {
    const p = createPanel(1920, 480);
    p.items.push(createItem("Gauge", { x: 100, y: 100 }));
    p.items.push(createItem("Label", { x: 0, y: 0 }));
    const json = serializePanel(p);
    const back = deserializePanel(json);
    expect(back).toEqual(p);
  });

  it("rejects malformed json instead of silently returning empty", () => {
    expect(() => deserializePanel("{ not json")).toThrow();
    expect(() => deserializePanel('{"size":{}}')).toThrow(); // items 欠落
  });
});
