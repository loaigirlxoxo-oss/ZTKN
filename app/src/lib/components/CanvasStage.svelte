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

  // present=表示専用（ドラッグ/選択/Transformer無効・ウィンドウにフィット）
  let { present = false }: { present?: boolean } = $props();

  let container: HTMLDivElement;
  let stage: Konva.Stage | undefined = $state();
  // 表示専用のフィット倍率（ウィンドウにアスペクト維持で収める）。編集時は editor.zoom を使う。
  let fitScale = $state(1);
  const viewScale = (): number => (present ? fitScale : editor.zoom);
  function recomputeFit(): void {
    if (!present) return;
    const sw = window.innerWidth, sh = window.innerHeight;
    fitScale = Math.max(0.05, Math.min(sw / editor.panel.size.w, sh / editor.panel.size.h));
  }

  // 矩形交差判定（ラバーバンド選択用）
  type Box = { x: number; y: number; w: number; h: number };
  const rectsIntersect = (a: Box, b: Box): boolean =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // --- スマートアラインガイド（PowerPoint風）。ドラッグ中に他アイテム/キャンバスの端・中央へ吸着し線を表示 ---
  let guideV: Konva.Line | undefined; // 縦ガイド線
  let guideH: Konva.Line | undefined; // 横ガイド線
  const showGuide = (l: Konva.Line | undefined, pts: number[]): void => { if (l) { l.points(pts); l.visible(true); l.moveToTop(); } };
  const hideGuide = (l: Konva.Line | undefined): void => { l?.visible(false); };
  function buildGuideTargets(exclude: Set<string>): { vx: number[]; hy: number[] } {
    const W = editor.panel.size.w, H = editor.panel.size.h;
    const vx = [0, W / 2, W], hy = [0, H / 2, H]; // キャンバスの端と中央
    for (const it of editor.panel.items) {
      if (exclude.has(it.id)) continue;
      vx.push(it.rect.x, it.rect.x + it.rect.w / 2, it.rect.x + it.rect.w);
      hy.push(it.rect.y, it.rect.y + it.rect.h / 2, it.rect.y + it.rect.h);
    }
    return { vx, hy };
  }
  // 3辺(左/中央/右 or 上/中央/下)のいずれかが、ターゲット線に閾値内なら最寄りへ吸着する量を返す
  function nearestSnap(edges: number[], lines: number[], thr: number): { delta: number; line: number } | null {
    let best: { delta: number; line: number } | null = null;
    for (const e of edges) for (const ln of lines) {
      const d = ln - e;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, line: ln };
    }
    return best;
  }
  let layer: Konva.Layer;
  let tr: Konva.Transformer;
  const groups = new Map<string, Konva.Group>();
  const outlines = new Map<string, Konva.Rect>(); // 複数選択時に各オブジェクトへ出す点線枠
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
    // 値が欠落(NaN)＝センサー切断時は淡色で「データなし」を示す。Labelは固定文言なので対象外。
    const baseFill = item.style.color;
    const MISSING = "#6b6b6b";
    const dimmable = item.kind === "SensorText";
    const tintFor = (val: number): string => (!dimmable || Number.isFinite(val) ? baseFill : MISSING);

    const parts = splitFormat(item.format ?? "%d");
    // 中央寄せ（ゲージ中心など）は数値＋単位をまとめて中央配置＝常に真ん中に揃う。
    // 単位固定の予約幅ロジックは左/右寄せ時のみ（中央寄せだと空き桁分だけ右へズレるため）。
    if (!parts || (parts.prefix === "" && parts.suffix === "") || centered) {
      const t = new Konva.Text({ ...font, text: itemDisplayText(item, v), x: 0, y, width: containerW, align: centered ? "center" : item.style.align, wrap: "none" });
      g.add(t);
      return (val) => { t.text(itemDisplayText(item, val)); t.fill(tintFor(val)); };
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
    const prefixNode = parts.prefix ? new Konva.Text({ ...font, text: parts.prefix, x: blockStart, y }) : null;
    if (prefixNode) g.add(prefixNode);
    const valueNode = new Konva.Text({ ...font, text: formatValue(parts.token, v), x: blockStart + prefixW, y, width: reserve, align: "right", wrap: "none" });
    g.add(valueNode);
    const suffixNode = parts.suffix ? new Konva.Text({ ...font, text: parts.suffix, x: blockStart + prefixW + reserve, y }) : null;
    if (suffixNode) g.add(suffixNode);
    return (val) => {
      valueNode.text(formatValue(parts.token, val));
      const c = tintFor(val);
      valueNode.fill(c); prefixNode?.fill(c); suffixNode?.fill(c);
    };
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
      rotation: item.rotation, opacity: item.opacity, id: item.id, draggable: !present,
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
      updaters.set(item.id, addValueUnit(g, item, v, item.rect.w, item.style.align === "center", 0));
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
          const drawFill = (p?: number[], col = gcolor, a = 0.25, baseY = h) => {
            if (!p || p.length < 4) return;
            c.beginPath(); c.moveTo(p[0], p[1]);
            for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
            c.lineTo(p[p.length - 2], baseY); c.lineTo(p[0], baseY); c.closePath();
            c.globalAlpha = a; c.fillStyle = col; c.fill(); c.globalAlpha = 1;
          };
          // 中心線(h/2)基準で上半分=下り／下半分=上りに圧縮（本来の上下対称グラフ）
          const halfTop = (p?: number[]) => p?.map((v, i) => (i % 2 === 1 ? v / 2 : v));
          const halfBot = (p?: number[]) => p?.map((v, i) => (i % 2 === 1 ? h - v / 2 : v));

          if (!isDual) {
            if (gstyle === "dots") { drawDots(pts); return; }
            if (gstyle === "spike") { drawSpike(pts); return; }
            if (gstyle === "filled") drawFill(pts);
            drawLine(pts);
            return;
          }
          // 2本系（下り=pts/gcolor、上り=up/gcolor2）
          switch (gstyle) {
            case "dual-mirrored": { const dt = halfTop(pts), ub = halfBot(up); drawLine(dt); drawLine(ub, gcolor2); break; }
            case "dual-filled-split": { const dt = halfTop(pts), ub = halfBot(up); drawFill(dt, gcolor, 0.25, h / 2); drawFill(ub, gcolor2, 0.25, h / 2); drawLine(dt); drawLine(ub, gcolor2); break; }
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

    if (!present) wireNode(g, item); // 表示専用は選択/ドラッグを付けない
    return g;
  }

  function wireNode(g: Konva.Group, item: PanelItem): void {
    g.on("mousedown touchstart", (e) => {
      e.cancelBubble = true; // ステージへ伝播させない（ラバーバンド開始を防ぐ）
      const additive = !!(e.evt as MouseEvent)?.shiftKey || !!(e.evt as MouseEvent)?.ctrlKey;
      if (additive) editor.toggleSelect(item.id);
      else if (!editor.selectedIds.includes(item.id)) editor.selectOnly(item.id);
      // 既に選択済みを通常クリック＝選択維持（複数選択のままグループドラッグできる）
    });
    // ドラッグ開始時に「一緒に動かすメンバー」の開始位置を記録（複数選択ならその全員）
    let dragStart: Map<string, { x: number; y: number }> | null = null;
    let guideTargets: { vx: number[]; hy: number[] } | null = null;
    g.on("dragstart", () => {
      const ids = editor.selectedIds.includes(item.id) && editor.selectedIds.length > 1 ? editor.selectedIds : [item.id];
      dragStart = new Map();
      for (const id of ids) { const ng = groups.get(id); if (ng) dragStart.set(id, { x: ng.x(), y: ng.y() }); }
      // 単一ドラッグのみスマートガイドを使う（自分自身は吸着対象から除外）
      guideTargets = ids.length === 1 ? buildGuideTargets(new Set(ids)) : null;
    });
    g.on("dragmove", () => {
      const w = item.rect.w, h = item.rect.h;
      let tlx = g.x() - w / 2, tly = g.y() - h / 2;
      if (guideTargets) {
        const thr = 6 / editor.zoom; // 画面上で約6px
        const sx = nearestSnap([tlx, tlx + w / 2, tlx + w], guideTargets.vx, thr);
        const sy = nearestSnap([tly, tly + h / 2, tly + h], guideTargets.hy, thr);
        if (sx) { tlx += sx.delta; showGuide(guideV, [sx.line, 0, sx.line, editor.panel.size.h]); } else hideGuide(guideV);
        if (sy) { tly += sy.delta; showGuide(guideH, [0, sy.line, editor.panel.size.w, sy.line]); } else hideGuide(guideH);
        g.position({ x: tlx + w / 2, y: tly + h / 2 });
      }
      // 複数選択は全員を同じ差分で移動（ガイドなし）
      const s = dragStart?.get(item.id);
      if (dragStart && dragStart.size > 1 && s) {
        const dx = g.x() - s.x, dy = g.y() - s.y;
        for (const [id, p] of dragStart) {
          const nx = p.x + dx, ny = p.y + dy;
          if (id !== item.id) groups.get(id)?.position({ x: nx, y: ny });
          outlines.get(id)?.position({ x: nx, y: ny });
        }
      } else {
        outlines.get(item.id)?.position({ x: g.x(), y: g.y() });
      }
      tr?.forceUpdate(); // 単一選択時はハンドルを追従
      layer.batchDraw();
    });
    g.on("dragend", () => {
      // offset=中心なので g.x()/y() は中心。rect は左上で持つ。選択全員を確定。
      const ids = dragStart ? [...dragStart.keys()] : [item.id];
      for (const id of ids) {
        const ng = groups.get(id); const it = editor.panel.items.find((i) => i.id === id);
        if (!ng || !it) continue;
        it.rect.x = Math.round(ng.x() - it.rect.w / 2);
        it.rect.y = Math.round(ng.y() - it.rect.h / 2);
        ng.position({ x: it.rect.x + it.rect.w / 2, y: it.rect.y + it.rect.h / 2 });
      }
      dragStart = null; guideTargets = null;
      hideGuide(guideV); hideGuide(guideH);
      editor.bumpStructure();
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
      item.rect.x = Math.round(cxAbs - w / 2);
      item.rect.y = Math.round(cyAbs - h / 2);
      item.rotation = Math.round(g.rotation());
      g.scale({ x: 1, y: 1 });
      editor.bumpStructure(); // 新サイズ・角度・フォントで作り直す
    });
  }

  // 選択の見せ方：単一はTransformer（リサイズ/回転ハンドル）、複数は各オブジェクトに点線枠。
  function refreshSelection(): void {
    if (present || !tr) return; // 表示専用は選択表示なし
    for (const o of outlines.values()) o.destroy();
    outlines.clear();
    const ids = editor.selectedIds;
    if (ids.length <= 1) {
      const g = ids.length === 1 ? groups.get(ids[0]) : undefined;
      tr.nodes(g ? [g] : []);
      return;
    }
    tr.nodes([]); // 複数は大枠を出さない
    for (const id of ids) {
      const g = groups.get(id);
      const it = editor.panel.items.find((i) => i.id === id);
      if (!g || !it) continue;
      // 中心offset＋rotationでグループと一致させる（回転アイテムでも枠がズレない）
      const o = new Konva.Rect({
        x: g.x(), y: g.y(), offsetX: it.rect.w / 2, offsetY: it.rect.h / 2,
        width: it.rect.w, height: it.rect.h, rotation: it.rotation,
        stroke: "#00d2c4", strokeWidth: 1, dash: [4, 3], listening: false,
      });
      layer.add(o); o.moveToTop(); outlines.set(id, o);
    }
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
    // Transformer は最前面（ハンドルがアイテムに隠れないように）。表示専用では作らない
    if (!present) {
      tr = new Konva.Transformer({ rotateEnabled: true, rotationSnaps: [0, 90, 180, 270], ignoreStroke: true });
      layer.add(tr);
      // スマートアラインのガイド線（ドラッグ中のみ表示）
      guideV = new Konva.Line({ stroke: "#ff3b6b", strokeWidth: 1, visible: false, listening: false, points: [0, 0, 0, 0] });
      guideH = new Konva.Line({ stroke: "#ff3b6b", strokeWidth: 1, visible: false, listening: false, points: [0, 0, 0, 0] });
      layer.add(guideV); layer.add(guideH);
      refreshSelection();
    }
    applyValues();
    layer.draw();
  }

  onMount(() => {
    recomputeFit();
    const z = viewScale();
    stage = new Konva.Stage({ container, width: editor.panel.size.w * z, height: editor.panel.size.h * z });
    stage.scale({ x: z, y: z });
    layer = new Konva.Layer();
    stage.add(layer);
    let detachWinUp: (() => void) | undefined;
    if (!present) {
      // 空き領域ドラッグ＝ラバーバンド選択。クリック（動かさず）＝選択解除。
      const st = stage; // クロージャ用に非null参照を固定
      let selRect: Konva.Rect | null = null;
      let startPos: { x: number; y: number } | null = null;
      const baseIds: string[] = []; // Shift追加選択の起点
      // 選択枠を片付ける。キャンバス内/外どちらで離しても必ず呼ぶ＝取り残し防止。
      const finishRubber = () => {
        if (!selRect) { startPos = null; return; }
        const box: Box = { x: selRect.x(), y: selRect.y(), w: selRect.width(), h: selRect.height() };
        selRect.destroy(); selRect = null;
        if (box.w > 3 || box.h > 3) {
          const hits = editor.panel.items.filter((it) => rectsIntersect(box, it.rect)).map((it) => it.id);
          editor.selectMany([...new Set([...baseIds, ...hits])]);
        }
        startPos = null;
        layer.batchDraw();
      };
      st.on("mousedown", (e) => {
        if (e.target !== st) return; // アイテム上は wireNode が処理
        const p = st.getRelativePointerPosition(); if (!p) return;
        startPos = p;
        const shift = !!(e.evt as MouseEvent)?.shiftKey;
        baseIds.length = 0;
        if (shift) baseIds.push(...editor.selectedIds);
        else editor.clearSelection();
        selRect = new Konva.Rect({ x: p.x, y: p.y, width: 0, height: 0, fill: "rgba(0,210,196,0.12)", stroke: "#00d2c4", strokeWidth: 1, listening: false });
        layer.add(selRect); selRect.moveToTop();
      });
      st.on("mousemove", () => {
        if (!selRect || !startPos) return;
        const p = st.getRelativePointerPosition(); if (!p) return;
        selRect.setAttrs({ x: Math.min(startPos.x, p.x), y: Math.min(startPos.y, p.y), width: Math.abs(p.x - startPos.x), height: Math.abs(p.y - startPos.y) });
        layer.batchDraw();
      });
      st.on("mouseup", finishRubber);
      // キャンバス外でマウスを離しても選択枠を取り残さない
      const onWinUp = () => finishRubber();
      window.addEventListener("mouseup", onWinUp);
      detachWinUp = () => window.removeEventListener("mouseup", onWinUp);
    }
    rebuild();
    let detachResize: (() => void) | undefined;
    if (present) {
      const onResize = () => { recomputeFit(); };
      window.addEventListener("resize", onResize);
      detachResize = () => window.removeEventListener("resize", onResize);
    }
    return () => { detachWinUp?.(); detachResize?.(); };
  });

  // 構造変更（追加/削除/リサイズ/プロパティ）だけで作り直す。
  // untrack で rebuild 内の values/selectedId 読み取りを依存から外す
  // （これをしないと1秒ごとの値更新で毎回フル再構築され、編集中の状態が飛ぶ）。
  $effect(() => { editor.structureVersion; if (stage) untrack(() => rebuild()); });
  // 選択変更で選択表示を更新（再構築しない）
  $effect(() => { editor.selectedIds; if (stage) untrack(() => { refreshSelection(); layer.batchDraw(); }); });
  // 値更新（1秒）は動的部分だけ更新（構造・サイズは維持）
  $effect(() => { editor.values; if (stage) untrack(() => applyValues()); });
  // パネルサイズ・表示倍率（編集=editor.zoom / 表示=fitScale）の変更でステージをリサイズ＆スケール
  $effect(() => {
    const w = editor.panel.size.w, h = editor.panel.size.h;
    const z = present ? fitScale : editor.zoom; // 依存にどちらも載せる
    if (stage) untrack(() => { stage!.size({ width: w * z, height: h * z }); stage!.scale({ x: z, y: z }); });
  });
</script>

<div
  bind:this={container}
  class="stage"
  class:present
  style="width:{editor.panel.size.w * (present ? fitScale : editor.zoom)}px;height:{editor.panel.size.h * (present ? fitScale : editor.zoom)}px"
></div>

<style>
  .stage { background: #0a0a0a; border: 1px solid #222; }
  /* 表示専用は枠なし・黒地（背景に溶け込ませる） */
  .stage.present { border: none; background: #000; }
</style>
