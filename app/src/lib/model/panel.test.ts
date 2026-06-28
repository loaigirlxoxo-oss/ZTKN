import { describe, it, expect } from "vitest";
import { createItem, createPanel } from "./panel";

describe("createItem", () => {
  it("creates a Label with sane defaults and unique id", () => {
    const a = createItem("Label", { x: 10, y: 20 });
    const b = createItem("Label", { x: 0, y: 0 });
    expect(a.kind).toBe("Label");
    expect(a.rect).toEqual({ x: 10, y: 20, w: 120, h: 32 });
    expect(a.opacity).toBe(1);
    expect(a.style.fontFamily).toBe("sans-serif");
    expect(a.id).not.toBe(b.id);
  });

  it("gives Gauge a default VectorArc render and range", () => {
    const g = createItem("Gauge", { x: 0, y: 0 });
    expect(g.range).toEqual([0, 100]);
    expect(g.gauge).toEqual({ mode: "VectorArc" });
  });
});

describe("createPanel", () => {
  it("creates an empty panel with given size", () => {
    const p = createPanel(1920, 480);
    expect(p.size).toEqual({ x: 0, y: 0, w: 1920, h: 480 });
    expect(p.items).toEqual([]);
  });
});
