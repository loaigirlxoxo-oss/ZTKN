<script lang="ts">
  import { onMount } from "svelte";
  import Konva from "konva";
  import { editor } from "$lib/editor/editorState.svelte";
  import type { PanelItem } from "$lib/model/panel";
  import { itemDisplayText } from "$lib/render/draw";
  import { valueToFraction } from "$lib/render/gauge";
  import { snap } from "$lib/editor/snap";

  let container: HTMLDivElement;
  let stage: Konva.Stage | undefined = $state();
  let layer: Konva.Layer;
  let tr: Konva.Transformer;
  const groups = new Map<string, Konva.Group>();
  const updaters = new Map<string, (v: number) => void>(); // 値だけ更新する関数

  function valueFor(item: PanelItem): number {
    return item.sensorSrc ? (editor.values.get(item.sensorSrc) ?? NaN) : NaN;
  }

  function buildNode(item: PanelItem): Konva.Group {
    const g = new Konva.Group({
      x: item.rect.x, y: item.rect.y, width: item.rect.w, height: item.rect.h,
      opacity: item.opacity, id: item.id, draggable: true,
    });
    const v = valueFor(item);

    if (item.kind === "Label" || item.kind === "SensorText") {
      const t = new Konva.Text({
        text: itemDisplayText(item, v), fontFamily: item.style.fontFamily,
        fontSize: item.style.fontSize, fontStyle: item.style.fontWeight,
        fill: item.style.color, width: item.rect.w, align: item.style.align,
      });
      g.add(t);
      updaters.set(item.id, (val) => t.text(itemDisplayText(item, val)));
    } else if (item.kind === "BarH" || item.kind === "BarV") {
      const [min, max] = item.range ?? [0, 100];
      g.add(new Konva.Rect({ width: item.rect.w, height: item.rect.h, stroke: item.style.color }));
      const fill = new Konva.Rect({ fill: item.style.color });
      g.add(fill);
      const apply = (val: number) => {
        const f = valueToFraction(val, min, max);
        if (item.kind === "BarH") fill.setAttrs({ x: 0, y: 0, width: item.rect.w * f, height: item.rect.h });
        else fill.setAttrs({ x: 0, y: item.rect.h * (1 - f), width: item.rect.w, height: item.rect.h * f });
      };
      apply(v); updaters.set(item.id, apply);
    } else if (item.kind === "Gauge") {
      const [min, max] = item.range ?? [0, 100];
      const r = Math.min(item.rect.w, item.rect.h) / 2;
      g.add(new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 270, rotation: 135, stroke: "#333", fill: "#222" }));
      const fillArc = new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 0, rotation: 135, fill: item.style.color });
      const label = new Konva.Text({ x: 0, y: r - item.style.fontSize / 2, width: r * 2, align: "center", text: "", fill: item.style.color, fontFamily: item.style.fontFamily, fontSize: item.style.fontSize });
      g.add(fillArc); g.add(label);
      const apply = (val: number) => { fillArc.angle(valueToFraction(val, min, max) * 270); label.text(itemDisplayText(item, val)); };
      apply(v); updaters.set(item.id, apply);
    }

    wireNode(g, item);
    return g;
  }

  function wireNode(g: Konva.Group, item: PanelItem): void {
    g.on("mousedown touchstart", (e) => { e.cancelBubble = true; editor.selectedId = item.id; });
    g.on("dragend", () => {
      item.rect.x = snap(g.x(), 5);
      item.rect.y = snap(g.y(), 5);
      g.position({ x: item.rect.x, y: item.rect.y });
      layer.batchDraw();
    });
    g.on("transformend", () => {
      item.rect.w = Math.max(8, Math.round(g.width() * g.scaleX()));
      item.rect.h = Math.max(8, Math.round(g.height() * g.scaleY()));
      g.scale({ x: 1, y: 1 });
      editor.bumpStructure(); // 新サイズで作り直す
    });
  }

  function attachTransformer(): void {
    const g = editor.selectedId ? groups.get(editor.selectedId) : undefined;
    tr.nodes(g ? [g] : []);
  }

  function applyValues(): void {
    for (const [id, fn] of updaters) {
      const item = editor.panel.items.find((i) => i.id === id);
      if (item) fn(valueFor(item));
    }
    layer.batchDraw();
  }

  function rebuild(): void {
    groups.clear(); updaters.clear();
    layer.destroyChildren();
    tr = new Konva.Transformer({ rotateEnabled: false, ignoreStroke: true });
    layer.add(tr);
    for (const item of [...editor.panel.items].sort((a, b) => a.z - b.z)) {
      const g = buildNode(item);
      groups.set(item.id, g);
      layer.add(g);
    }
    attachTransformer();
    applyValues();
    layer.draw();
  }

  onMount(() => {
    stage = new Konva.Stage({ container, width: editor.panel.size.w, height: editor.panel.size.h });
    layer = new Konva.Layer();
    stage.add(layer);
    stage.on("mousedown touchstart", (e) => { if (e.target === stage) editor.selectedId = null; });
    rebuild();
  });

  // 構造変更（追加/削除/リサイズ/プロパティ）で作り直し
  $effect(() => { editor.structureVersion; editor.panel.items.length; if (stage) rebuild(); });
  // 選択変更で Transformer を付け替え
  $effect(() => { editor.selectedId; if (stage) { attachTransformer(); layer.batchDraw(); } });
  // 値更新（1秒）で動的部分だけ更新（構造は維持）
  $effect(() => { editor.values; if (stage) applyValues(); });
</script>

<div bind:this={container} class="stage" style="width:{editor.panel.size.w}px;height:{editor.panel.size.h}px"></div>

<style>
  .stage { background: #0a0a0a; border: 1px solid #222; }
</style>
