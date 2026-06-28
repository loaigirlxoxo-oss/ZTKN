<script lang="ts">
  import { onMount, untrack } from "svelte";
  import Konva from "konva";
  import { editor } from "$lib/editor/editorState.svelte";
  import type { PanelItem } from "$lib/model/panel";
  import { itemDisplayText } from "$lib/render/draw";
  import { formatValue, splitFormat } from "$lib/render/format";
  import { formatDate } from "$lib/render/datetime";
  import { valueToFraction } from "$lib/render/gauge";
  import { historyToPoints, graphScale, autoRateUnit } from "$lib/render/graph";
  import { getImage, loadImage } from "$lib/render/images";
  import { snap } from "$lib/editor/snap";

  let container: HTMLDivElement;
  let stage: Konva.Stage | undefined = $state();
  let layer: Konva.Layer;
  let tr: Konva.Transformer;
  const groups = new Map<string, Konva.Group>();
  const updaters = new Map<string, (v: number) => void>(); // 値だけ更新する関数

  function valueFor(item: PanelItem): number {
    const scale = item.valueScale ?? 1;
    if (item.sensorSum && item.sensorSum.length) {
      let sum = 0, any = false;
      for (const id of item.sensorSum) {
        const v = editor.values.get(id);
        if (v !== undefined && Number.isFinite(v)) { sum += v; any = true; }
      }
      return any ? sum * scale : NaN;
    }
    return item.sensorSrc ? (editor.values.get(item.sensorSrc) ?? NaN) * scale : NaN;
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

  // ローカル画像を Konva.Image として配置（未ロードなら後追いで差し込む）。
  function addImageNode(g: Konva.Group, path: string, w: number, h: number): Konva.Image {
    const node = new Konva.Image({ width: w, height: h, image: getImage(path) });
    g.add(node);
    if (!getImage(path)) {
      loadImage(path).then((img) => { node.image(img); node.getLayer()?.batchDraw(); }).catch(() => {});
    }
    return node;
  }

  // 連番画像ゲージ（AIDA64 state-01..NN）。値で表示フレームを切り替える。
  function addStateFrames(g: Konva.Group, frames: string[], w: number, h: number, min: number, max: number, v: number): (val: number) => void {
    const node = new Konva.Image({ width: w, height: h, image: undefined });
    g.add(node);
    for (const f of frames) {
      if (!getImage(f)) loadImage(f).then(() => node.getLayer()?.batchDraw()).catch(() => {});
    }
    const apply = (val: number) => {
      if (frames.length === 0) return;
      const fr = valueToFraction(val, min, max);
      const idx = Math.min(frames.length - 1, Math.max(0, Math.round(fr * (frames.length - 1))));
      const img = getImage(frames[idx]);
      if (img) node.image(img);
    };
    apply(v);
    return apply;
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
    // 透明なヒット領域：枠内どこでもクリックで選択できる（中空ゲージ/余白/小さい表示でも当たる）
    g.add(new Konva.Rect({ width: item.rect.w, height: item.rect.h, fill: "rgba(0,0,0,0)" }));
    const v = valueFor(item);

    if (item.kind === "Box") {
      const cr = item.cornerRadius ?? 0;
      // 塗りと枠を別ノードにして色・透過を部品ごとに調整可能
      g.add(new Konva.Rect({ width: item.rect.w, height: item.rect.h, cornerRadius: cr, fill: item.bgColor ?? "#222222", opacity: item.bgOpacity ?? 1 }));
      g.add(new Konva.Rect({ width: item.rect.w, height: item.rect.h, cornerRadius: cr, stroke: item.frameColor ?? "#888888", strokeWidth: item.borderWidth ?? 1, opacity: item.frameOpacity ?? 1 }));
    } else if (item.kind === "Line") {
      g.add(new Konva.Line({ points: [0, item.rect.h / 2, item.rect.w, item.rect.h / 2], stroke: item.style.color, strokeWidth: item.lineWidth ?? 2, lineCap: "round" }));
    } else if (item.kind === "DateTime") {
      const t = new Konva.Text({
        text: "", x: 0, y: 0, width: item.rect.w, align: item.style.align,
        fontFamily: item.style.fontFamily, fontSize: item.style.fontSize,
        fontStyle: item.style.fontWeight, fill: item.style.color,
      });
      g.add(t);
      const fmt = item.format ?? "HH:mm:ss";
      const upd = () => t.text(formatDate(fmt, new Date()));
      upd();
      updaters.set(item.id, upd); // 1秒ごとの値tickで更新
    } else if (item.kind === "Label" || item.kind === "SensorText") {
      updaters.set(item.id, addValueUnit(g, item, v, item.rect.w, false, 0));
    } else if (item.kind === "BarH" || item.kind === "BarV") {
      const [min, max] = item.range ?? [0, 100];
      const w = item.rect.w, h = item.rect.h;
      const pad = 1; // 枠線幅ぶんだけ内側に寄せ、枠とバーを隙間なく接させる
      const innerW = Math.max(0, w - pad * 2), innerH = Math.max(0, h - pad * 2);
      // 背景トラック（内側）
      g.add(new Konva.Rect({ x: pad, y: pad, width: innerW, height: innerH, fill: item.bgColor ?? "#333333", opacity: item.bgOpacity ?? 1 }));
      // 値バー：クリップ群で露出量を制御し、グラデは全長に固定（伸縮で色が変わらない）
      const color1 = item.style.color;
      const color2 = item.gradColor ?? item.style.color;
      const grad = item.useGradient
        ? (item.kind === "BarH"
            ? { fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: innerW, y: 0 }, fillLinearGradientColorStops: [0, color1, 1, color2] }
            : { fillLinearGradientStartPoint: { x: 0, y: innerH }, fillLinearGradientEndPoint: { x: 0, y: 0 }, fillLinearGradientColorStops: [0, color1, 1, color2] })
        : { fill: color1 };
      const clipGroup = new Konva.Group({ x: pad, y: pad, clipX: 0, clipY: 0, clipWidth: innerW, clipHeight: innerH });
      clipGroup.add(new Konva.Rect({ width: innerW, height: innerH, ...grad }));
      g.add(clipGroup);
      // 枠（線を内側に収め、内側エッジが pad=1 に来てバーと隙間なく接する）
      g.add(new Konva.Rect({ x: 0.5, y: 0.5, width: w - 1, height: h - 1, stroke: item.frameColor ?? item.style.color, strokeWidth: 1, opacity: item.frameOpacity ?? 1 }));
      const apply = (val: number) => {
        const f = valueToFraction(val, min, max);
        if (item.kind === "BarH") {
          clipGroup.clipX(0); clipGroup.clipY(0); clipGroup.clipWidth(innerW * f); clipGroup.clipHeight(innerH);
        } else {
          clipGroup.clipX(0); clipGroup.clipWidth(innerW); clipGroup.clipY(innerH * (1 - f)); clipGroup.clipHeight(innerH * f);
        }
      };
      apply(v); updaters.set(item.id, apply);
    } else if (item.kind === "Image") {
      if (item.asset) addImageNode(g, item.asset, item.rect.w, item.rect.h);
    } else if (item.kind === "Gauge" && item.gauge?.mode === "StateFrames") {
      const [min, max] = item.range ?? [0, 100];
      updaters.set(item.id, addStateFrames(g, item.gauge.frames, item.rect.w, item.rect.h, min, max, v));
    } else if (item.kind === "Gauge") {
      const [min, max] = item.range ?? [0, 100];
      const r = Math.min(item.rect.w, item.rect.h) / 2;
      // 背景トラック（塗り）と枠（輪郭）を別ノードにして透過度を独立させる
      g.add(new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 270, rotation: 135, fill: item.bgColor ?? "#222222", opacity: item.bgOpacity ?? 1 }));
      const fillArc = new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 0, rotation: 135, fill: item.style.color });
      g.add(fillArc);
      g.add(new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 270, rotation: 135, stroke: item.frameColor ?? "#333333", strokeWidth: 1, opacity: item.frameOpacity ?? 1 }));
      // 中央は数値を出さず透過（リング内側は innerRadius=0.7r で空＝透過のまま）
      const apply = (val: number) => { fillArc.angle(valueToFraction(val, min, max) * 270); };
      apply(v); updaters.set(item.id, apply);
    } else if (item.kind === "GraphLine") {
      // 時系列折れ線（ネットワーク速度などの履歴）。背景透過可・グリッド線+上中下の目盛りラベル。
      const w = item.rect.w, h = item.rect.h;
      // 背景と枠を別ノードにして透過度を独立させる
      g.add(new Konva.Rect({ width: w, height: h, fill: item.bgColor ?? "#0d0d0d", opacity: item.bgOpacity ?? 0 }));
      g.add(new Konva.Rect({ width: w, height: h, stroke: item.frameColor ?? "#333333", strokeWidth: 1, opacity: item.frameOpacity ?? 1 }));
      const showScale = item.showScale !== false;
      if (showScale) {
        // グリッド線（上/中/下）
        for (const gy of [0.5, h / 2, h - 0.5]) {
          g.add(new Konva.Line({ points: [0, gy, w, gy], stroke: "#3a3a3a", strokeWidth: 1, opacity: 0.7 }));
        }
      }
      const gstyle = item.graphStyle ?? "line";
      const gcolor = item.style.color;
      const gcolor2 = item.color2 ?? "#ff3484";
      const isDual = gstyle.startsWith("dual");
      const graph = new Konva.Shape({
        sceneFunc: (ctx, shp) => {
          const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
          const pts = shp.getAttr("pts") as number[] | undefined;
          const up = shp.getAttr("pts2") as number[] | undefined;
          const drawLine = (p?: number[], col = gcolor, wd = 1.5) => {
            if (!p || p.length < 4) return;
            c.beginPath(); c.moveTo(p[0], p[1]);
            for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
            c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = col; c.lineWidth = wd; c.stroke();
          };
          const drawDots = (p?: number[], col = gcolor) => {
            if (!p) return; c.beginPath();
            for (let i = 0; i < p.length; i += 2) { c.moveTo(p[i] + 1.4, p[i + 1]); c.arc(p[i], p[i + 1], 1.4, 0, Math.PI * 2); }
            c.fillStyle = col; c.fill();
          };
          const drawSpike = (p?: number[], col = gcolor) => {
            if (!p) return; c.beginPath();
            for (let i = 0; i < p.length; i += 2) { c.moveTo(p[i], h); c.lineTo(p[i], p[i + 1]); }
            c.strokeStyle = col; c.lineWidth = 1; c.stroke();
          };
          const drawFill = (p?: number[], col = gcolor, a = 0.25) => {
            if (!p || p.length < 4) return;
            c.beginPath(); c.moveTo(p[0], p[1]);
            for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
            c.lineTo(p[p.length - 2], h); c.lineTo(p[0], h); c.closePath();
            c.globalAlpha = a; c.fillStyle = col; c.fill(); c.globalAlpha = 1;
          };
          const flip = (p?: number[]) => p?.map((v, i) => (i % 2 === 1 ? h - v : v));

          if (!isDual) {
            if (gstyle === "dots") { drawDots(pts); return; }
            if (gstyle === "spike") { drawSpike(pts); return; }
            if (gstyle === "filled") drawFill(pts);
            drawLine(pts);
            return;
          }
          // 2本系（下り=pts/gcolor、上り=up/gcolor2）
          switch (gstyle) {
            case "dual-mirrored": drawLine(pts); drawLine(flip(up), gcolor2); break;
            case "dual-filled-split": { const fu = flip(up); drawFill(pts); drawFill(fu, gcolor2); drawLine(pts); drawLine(fu, gcolor2); break; }
            case "dual-bars": drawSpike(pts); drawLine(up, gcolor2); break;
            case "dual-dotted": drawDots(pts); drawDots(up, gcolor2); break;
            case "dual-scanband":
              if (pts && up && pts.length >= 4 && up.length >= 4) {
                c.beginPath(); c.moveTo(pts[0], pts[1]);
                for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
                for (let i = up.length - 2; i >= 0; i -= 2) c.lineTo(up[i], up[i + 1]);
                c.closePath(); c.globalAlpha = 0.22; c.fillStyle = gcolor; c.fill(); c.globalAlpha = 1;
              }
              drawLine(pts); drawLine(up, gcolor2); break;
            default: drawLine(pts); drawLine(up, gcolor2); break; // basic / crossing
          }
        },
      });
      g.add(graph);
      const scaleFont = { fontFamily: item.style.fontFamily, fontSize: 11, fill: "#9aa" };
      const topLabel = showScale ? new Konva.Text({ ...scaleFont, x: 3, y: 2, text: "" }) : null;
      const midLabel = showScale ? new Konva.Text({ ...scaleFont, x: 3, y: h / 2 - 13, text: "" }) : null;
      const botLabel = showScale ? new Konva.Text({ ...scaleFont, x: 3, y: h - 14, text: "" }) : null;
      if (topLabel) g.add(topLabel);
      if (midLabel) g.add(midLabel);
      if (botLabel) g.add(botLabel);
      const fmt = (n: number) => (Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1));
      const vscale = item.valueScale ?? 1;
      const scaled = (a: number[]) => (vscale === 1 ? a : a.map((v) => v * vscale));
      const apply = () => {
        const hist = scaled(item.sensorSrc ? (editor.history.get(item.sensorSrc) ?? []) : []);
        const hist2 = scaled(isDual && item.sensorSrc2 ? (editor.history.get(item.sensorSrc2) ?? []) : []);
        // 2本系は両方を同じスケールで（比較できるように）
        const [mn, mx] = graphScale([...hist, ...hist2], item.range);
        graph.setAttr("pts", historyToPoints(hist, w, h, [mn, mx]));
        if (isDual) graph.setAttr("pts2", historyToPoints(hist2, w, h, [mn, mx]));
        if (!showScale) return;
        // 表示単位：自動ON ならスケール上限に追従(Kbps↔Mbps↔Gbps)、OFF なら入力単位を固定
        const { unit, factor } = item.autoUnit === false
          ? { unit: item.unit ?? "", factor: 1 }
          : autoRateUnit(item.unit ?? "", mx);
        const suffix = unit ? ` ${unit}` : "";
        topLabel!.text(fmt(mx * factor) + suffix);
        midLabel!.text(fmt(((mn + mx) / 2) * factor) + suffix);
        botLabel!.text(fmt(mn * factor) + suffix);
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
      if (item.kind === "Label" || item.kind === "SensorText" || item.kind === "DateTime") {
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
    // 背景画像（最下層・選択対象外）
    const bgPath = editor.panel.background;
    if (bgPath) {
      const bg = new Konva.Image({ x: 0, y: 0, width: editor.panel.size.w, height: editor.panel.size.h, image: getImage(bgPath), listening: false });
      layer.add(bg);
      if (!getImage(bgPath)) loadImage(bgPath).then((img) => { bg.image(img); layer.batchDraw(); }).catch(() => {});
    }
    for (const item of [...editor.panel.items].sort((a, b) => a.z - b.z)) {
      const g = buildNode(item);
      groups.set(item.id, g);
      layer.add(g);
    }
    // Transformer は最前面（ハンドルがアイテムに隠れないように）
    tr = new Konva.Transformer({ rotateEnabled: true, rotationSnaps: [0, 90, 180, 270], ignoreStroke: true });
    layer.add(tr);
    attachTransformer();
    applyValues();
    layer.draw();
  }

  onMount(() => {
    stage = new Konva.Stage({ container, width: editor.panel.size.w * editor.zoom, height: editor.panel.size.h * editor.zoom });
    stage.scale({ x: editor.zoom, y: editor.zoom });
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
  // パネルサイズ・表示倍率の変更で Konva ステージをリサイズ＆スケール
  $effect(() => {
    const w = editor.panel.size.w, h = editor.panel.size.h, z = editor.zoom;
    if (stage) untrack(() => { stage!.size({ width: w * z, height: h * z }); stage!.scale({ x: z, y: z }); });
  });
</script>

<div bind:this={container} class="stage" style="width:{editor.panel.size.w * editor.zoom}px;height:{editor.panel.size.h * editor.zoom}px"></div>

<style>
  .stage { background: #0a0a0a; border: 1px solid #222; }
</style>
