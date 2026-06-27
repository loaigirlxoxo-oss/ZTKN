<script lang="ts">
  import { onMount, untrack } from "svelte";
  import Konva from "konva";
  import { editor } from "$lib/editor/editorState.svelte";
  import type { PanelItem } from "$lib/model/panel";
  import { itemDisplayText } from "$lib/render/draw";
  import { formatValue, splitFormat } from "$lib/render/format";
  import { valueToFraction } from "$lib/render/gauge";
  import { historyToPoints, graphScale, autoRateUnit } from "$lib/render/graph";
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

  // 値+単位を描く共通処理。数値は右寄せで右端固定、単位は固定位置に置くので
  // 桁が増減しても単位（°C や %）がずれない。戻り値は値だけ更新する関数。
  function addValueUnit(g: Konva.Group, item: PanelItem, v: number, containerW: number, centered: boolean, y: number): (val: number) => void {
    const font = {
      fontFamily: item.style.fontFamily, fontSize: item.style.fontSize,
      fontStyle: item.style.fontWeight, fill: item.style.color,
    };
    const parts = splitFormat(item.format ?? "%d");
    if (!parts || (parts.prefix === "" && parts.suffix === "")) {
      // リテラル or 単位なしの数値 → 単一テキスト
      const t = new Konva.Text({ ...font, text: itemDisplayText(item, v), x: 0, y, width: containerW, align: centered ? "center" : item.style.align });
      g.add(t);
      return (val) => t.text(itemDisplayText(item, val));
    }
    const measure = (s: string) => new Konva.Text({ ...font, text: s }).width();
    const decMatch = parts.token.match(/\.(\d+)/);
    const decimals = decMatch ? Number(decMatch[1]) : 0;
    let intDigits = 3;
    if (item.range) intDigits = Math.max(String(Math.round(item.range[0])).length, String(Math.round(item.range[1])).length);
    const sample = "8".repeat(Math.max(1, intDigits)) + (decimals > 0 ? "." + "8".repeat(decimals) : "");
    const reserve = measure(sample);
    const prefixW = parts.prefix ? measure(parts.prefix) : 0;
    const suffixW = parts.suffix ? measure(parts.suffix) : 0;
    // ブロック全体の幅は live 値に依存しない（予約幅で固定）→ 中央寄せでも単位位置が動かない
    const blockStart = centered ? Math.max(0, (containerW - (prefixW + reserve + suffixW)) / 2) : 0;
    if (parts.prefix) g.add(new Konva.Text({ ...font, text: parts.prefix, x: blockStart, y }));
    const valueNode = new Konva.Text({ ...font, text: formatValue(parts.token, v), x: blockStart + prefixW, y, width: reserve, align: "right" });
    g.add(valueNode);
    if (parts.suffix) g.add(new Konva.Text({ ...font, text: parts.suffix, x: blockStart + prefixW + reserve, y }));
    return (val) => valueNode.text(formatValue(parts.token, val));
  }

  function buildNode(item: PanelItem): Konva.Group {
    // offset を中心に置くことで、回転（ハンドル・数値とも）がオブジェクト中心を軸になる。
    // 子は従来どおり 0..w,0..h に描き、offset が左上を rect.x/y に合わせる。
    const cx = item.rect.w / 2, cy = item.rect.h / 2;
    const g = new Konva.Group({
      x: item.rect.x + cx, y: item.rect.y + cy, offsetX: cx, offsetY: cy,
      width: item.rect.w, height: item.rect.h,
      rotation: item.rotation, opacity: item.opacity, id: item.id, draggable: true,
    });
    const v = valueFor(item);

    if (item.kind === "Label" || item.kind === "SensorText") {
      updaters.set(item.id, addValueUnit(g, item, v, item.rect.w, false, 0));
    } else if (item.kind === "BarH" || item.kind === "BarV") {
      const [min, max] = item.range ?? [0, 100];
      // 背景トラック（全体opacityとは別に背景だけ透過可）
      g.add(new Konva.Rect({ width: item.rect.w, height: item.rect.h, fill: item.bgColor ?? "#333333", opacity: item.bgOpacity ?? 1 }));
      const fill = new Konva.Rect({ fill: item.style.color });
      g.add(fill);
      g.add(new Konva.Rect({ width: item.rect.w, height: item.rect.h, stroke: item.style.color, strokeWidth: 1 }));
      const apply = (val: number) => {
        const f = valueToFraction(val, min, max);
        if (item.kind === "BarH") fill.setAttrs({ x: 0, y: 0, width: item.rect.w * f, height: item.rect.h });
        else fill.setAttrs({ x: 0, y: item.rect.h * (1 - f), width: item.rect.w, height: item.rect.h * f });
      };
      apply(v); updaters.set(item.id, apply);
    } else if (item.kind === "Gauge") {
      const [min, max] = item.range ?? [0, 100];
      const r = Math.min(item.rect.w, item.rect.h) / 2;
      g.add(new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 270, rotation: 135, stroke: "#333", fill: item.bgColor ?? "#222222", opacity: item.bgOpacity ?? 1 }));
      const fillArc = new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 0, rotation: 135, fill: item.style.color });
      g.add(fillArc);
      // 中央は数値を出さず透過（リング内側は innerRadius=0.7r で空＝透過のまま）
      const apply = (val: number) => { fillArc.angle(valueToFraction(val, min, max) * 270); };
      apply(v); updaters.set(item.id, apply);
    } else if (item.kind === "GraphLine") {
      // 時系列折れ線（ネットワーク速度などの履歴）。背景透過可・グリッド線+上中下の目盛りラベル。
      const w = item.rect.w, h = item.rect.h;
      g.add(new Konva.Rect({ width: w, height: h, stroke: "#333", strokeWidth: 1, fill: item.bgColor ?? "#0d0d0d", opacity: item.bgOpacity ?? 0 }));
      // グリッド線（上/中/下）
      for (const gy of [0.5, h / 2, h - 0.5]) {
        g.add(new Konva.Line({ points: [0, gy, w, gy], stroke: "#3a3a3a", strokeWidth: 1, opacity: 0.7 }));
      }
      const line = new Konva.Line({ points: [], stroke: item.style.color, strokeWidth: 1.5, lineJoin: "round", lineCap: "round" });
      g.add(line);
      const scaleFont = { fontFamily: item.style.fontFamily, fontSize: 11, fill: "#9aa" };
      const topLabel = new Konva.Text({ ...scaleFont, x: 3, y: 2, text: "" });
      const midLabel = new Konva.Text({ ...scaleFont, x: 3, y: h / 2 - 13, text: "" });
      const botLabel = new Konva.Text({ ...scaleFont, x: 3, y: h - 14, text: "" });
      g.add(topLabel); g.add(midLabel); g.add(botLabel);
      const fmt = (n: number) => (Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1));
      const apply = () => {
        const hist = item.sensorSrc ? (editor.history.get(item.sensorSrc) ?? []) : [];
        line.points(historyToPoints(hist, w, h, item.range));
        const [mn, mx] = graphScale(hist, item.range);
        // 表示単位をスケール上限に追従（Kbps↔Mbps↔Gbps）
        const { unit, factor } = autoRateUnit(item.unit ?? "", mx);
        const suffix = unit ? ` ${unit}` : "";
        topLabel.text(fmt(mx * factor) + suffix);
        midLabel.text(fmt(((mn + mx) / 2) * factor) + suffix);
        botLabel.text(fmt(mn * factor) + suffix);
      };
      apply();
      updaters.set(item.id, () => apply()); // 値は履歴から読むので引数は使わない
    }

    wireNode(g, item);
    return g;
  }

  function wireNode(g: Konva.Group, item: PanelItem): void {
    g.on("mousedown touchstart", (e) => { e.cancelBubble = true; editor.selectedId = item.id; });
    g.on("dragend", () => {
      // offset=中心なので g.x()/y() は中心。rect は左上で持つ。
      item.rect.x = snap(g.x() - item.rect.w / 2, 5);
      item.rect.y = snap(g.y() - item.rect.h / 2, 5);
      g.position({ x: item.rect.x + item.rect.w / 2, y: item.rect.y + item.rect.h / 2 });
      layer.batchDraw();
    });
    g.on("transformend", () => {
      const sx = g.scaleX(), sy = g.scaleY();
      const w = Math.max(8, Math.round(g.width() * sx));
      const h = Math.max(8, Math.round(g.height() * sy));
      // テキスト系は縦方向の拡縮にフォントサイズを追従させる（箱だけ伸びて文字が戻る問題の解消）
      if (item.kind === "Label" || item.kind === "SensorText") {
        item.style.fontSize = Math.max(6, Math.round(item.style.fontSize * sy));
      }
      const cxAbs = g.x(), cyAbs = g.y(); // offset=中心なので現在の中心座標
      item.rect.w = w;
      item.rect.h = h;
      item.rect.x = snap(cxAbs - w / 2, 5);
      item.rect.y = snap(cyAbs - h / 2, 5);
      item.rotation = Math.round(g.rotation());
      g.scale({ x: 1, y: 1 });
      editor.bumpStructure(); // 新サイズ・角度・フォントで作り直す
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
    tr = new Konva.Transformer({ rotateEnabled: true, rotationSnaps: [0, 90, 180, 270], ignoreStroke: true });
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

  // 構造変更（追加/削除/リサイズ/プロパティ）だけで作り直す。
  // untrack で rebuild 内の values/selectedId 読み取りを依存から外す
  // （これをしないと1秒ごとの値更新で毎回フル再構築され、編集中の状態が飛ぶ）。
  $effect(() => { editor.structureVersion; if (stage) untrack(() => rebuild()); });
  // 選択変更で Transformer を付け替え（再構築しない）
  $effect(() => { editor.selectedId; if (stage) untrack(() => { attachTransformer(); layer.batchDraw(); }); });
  // 値更新（1秒）は動的部分だけ更新（構造・サイズは維持）
  $effect(() => { editor.values; if (stage) untrack(() => applyValues()); });
  // パネル（レイアウト）サイズ変更で Konva ステージをリサイズ
  $effect(() => { const w = editor.panel.size.w, h = editor.panel.size.h; if (stage) untrack(() => stage!.size({ width: w, height: h })); });
</script>

<div bind:this={container} class="stage" style="width:{editor.panel.size.w}px;height:{editor.panel.size.h}px"></div>

<style>
  .stage { background: #0a0a0a; border: 1px solid #222; }
</style>
