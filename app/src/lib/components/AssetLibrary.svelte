<script lang="ts">
  import { onMount } from "svelte";
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import { library, type AssetSet } from "$lib/assets/library.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { createItem } from "$lib/model/panel";
  import { sensors } from "$lib/sensors/live.svelte";
  import { pickSensor } from "$lib/sensors/match";
  import { loadImage } from "$lib/render/images";

  // 1枚絵（image/ フォルダ。Assetsとは別の浅い置き場）
  let images = $state<string[]>([]);
  async function refreshImages(): Promise<void> {
    try { images = await invoke<string[]>("list_images"); } catch { images = []; }
  }
  onMount(refreshImages);

  // 選択中Imageに割当（未選択/別種なら新規Image作成）。サイズは元画像の縦横比で初期化。
  function assignImage(path: string): void {
    let item = editor.selected;
    if (!item || item.kind !== "Image") {
      item = createItem("Image", { x: 80, y: 80 });
      editor.panel.items.push(item);
      editor.selectedId = item.id;
    }
    const it = item;
    it.asset = path;
    loadImage(path).then((img) => {
      const maxW = 480, scale = Math.min(1, maxW / (img.naturalWidth || maxW));
      it.rect.w = Math.max(8, Math.round((img.naturalWidth || 120) * scale));
      it.rect.h = Math.max(8, Math.round((img.naturalHeight || 120) * scale));
      editor.bumpStructure();
    }).catch(() => {});
    editor.bumpStructure();
  }
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  type GraphStyle =
    | "line" | "filled" | "dots" | "spike"
    | "dual-basic" | "dual-crossing" | "dual-mirrored" | "dual-filled-split"
    | "dual-bars" | "dual-dotted" | "dual-scanband" | "dual-linedot";

  onMount(() => { library.refresh(); });

  // パック構成をそのまま自動解釈。リネーム不要。背景/線グラフ/枠はパス語、ゲージは連番(8枚以上)で判定。
  // guide/live/proposal・端数フォルダ・カバー画像は除外（＝意図しない取り込みを防ぐ）。タブ＝トップのパック名。
  type Cat = "bg" | "circle" | "horizontal" | "graph" | "frame";
  interface Classified { cat: Cat; group: string; leaf: string; set: AssetSet; }
  function classify(s: AssetSet): Classified | null {
    const n = s.name.toLowerCase();
    const parts = s.name.split("/");
    const pack = parts[0];
    const leaf = parts.slice(1).join("/") || parts[0];
    if (/\bguide\b|proposal|(^|\/)live(\/|$)/.test(n)) return null; // 説明/デモ/デザイン案
    if (n.includes("background") || n.includes("backdrop")) return { cat: "bg", group: pack, leaf, set: s };
    if (n.includes("line-graph")) return { cat: "graph", group: pack, leaf, set: s };
    if (n.includes("frame")) return { cat: "frame", group: pack, leaf, set: s };
    if (s.files.length >= 8) { // 連番フレーム＝ゲージ
      const c: Cat = (n.includes("horizontal") || /\bbar\b|bar-/.test(n)) ? "horizontal" : "circle";
      return { cat: c, group: pack, leaf, set: s };
    }
    return null; // カバー1枚・端数フォルダ等は取り込まない
  }
  const classified = $derived(library.sets.map(classify).filter((c): c is Classified => c !== null));
  const groups = $derived([...new Set(classified.map((c) => c.group))].sort());
  let activeTab = $state("");
  $effect(() => { if (groups.length && !groups.includes(activeTab)) activeTab = groups[0]; });
  const inTab = $derived(classified.filter((c) => c.group === activeTab));
  const tabBg = $derived(inTab.filter((c) => c.cat === "bg"));
  const tabCircle = $derived(inTab.filter((c) => c.cat === "circle"));
  const tabHorizontal = $derived(inTab.filter((c) => c.cat === "horizontal"));
  const tabGraph = $derived(inTab.filter((c) => c.cat === "graph"));
  const tabFrame = $derived(inTab.filter((c) => c.cat === "frame"));

  // 線グラフスタイル: フォルダ名→スタイル、ファイル名→色
  const GRAPH_COLORS: Record<string, string> = {
    cream: "#eee8d6", cyan: "#00d2c4", lime: "#6af62a", pink: "#ff3484", purple: "#8652ff", yellow: "#f4d35e",
    violet: "#8652ff", orange: "#ff8a3b", blue: "#3aa0ff", red: "#ff3b6b",
  };
  // フォルダ/ファイル名→内蔵スタイル。AIDA64名とPOP名の両方に対応。
  function styleFromName(name: string): GraphStyle {
    const n = name.toLowerCase();
    if (n.includes("dual")) {
      if (n.includes("crossing")) return "dual-crossing";
      if (n.includes("mirrored") || n.includes("split-lane")) return "dual-mirrored"; // split-lane=上下2レーン
      if (n.includes("filled-split") || n.includes("mirror-fill")) return "dual-filled-split";
      if (n.includes("bars")) return "dual-bars";
      if (n.includes("dot-line")) return "dual-linedot"; // 線＋点
      if (n.includes("dotted")) return "dual-dotted";
      if (n.includes("scanband")) return "dual-scanband";
      return "dual-basic"; // twin-wave 等
    }
    if (n.includes("dot-matrix") || n.includes("dot-pulse")) return "dots";
    if (n.includes("filled-scan") || n.includes("scan-ribbon")) return "filled";
    if (n.includes("spike-trace")) return "spike"; // ink-spike は除外（実態は太いウェーブ線）
    return "line"; // clean-wave / pop-wave / ink-spike 等
  }
  const isPop = (name: string) => /pop-wave|dot-pulse|ink-spike|scan-ribbon|twin-wave|split-lane|dot-line|mirror-fill/.test(name.toLowerCase());
  function colorFromFile(path: string): string {
    const f = path.toLowerCase();
    for (const [name, hex] of Object.entries(GRAPH_COLORS)) if (f.includes(name)) return hex;
    return "#00d2c4";
  }
  // dualファイル名の2色（出現順）。例 "01-basic-cyan-pink.png" → [cyan,pink]
  function colorsFromFile(path: string): [string, string] {
    const f = path.toLowerCase().replace(/\.[^.]+$/, "");
    const hits = Object.keys(GRAPH_COLORS)
      .map((n) => ({ n, idx: f.indexOf(n) }))
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx);
    const last = hits[hits.length - 1];
    return [hits[0] ? GRAPH_COLORS[hits[0].n] : "#00d2c4", hits.length > 1 && last ? GRAPH_COLORS[last.n] : "#ff3484"];
  }
  // ファイル名に出てくる色を順番に全部拾う（多段グラデ用）。例 "...cyan-lime-yellow" → [cyan,lime,yellow]
  function allColorsFromFile(path: string): string[] {
    const f = path.toLowerCase().replace(/\.[^.]+$/, "");
    return Object.keys(GRAPH_COLORS)
      .map((n) => ({ n, idx: f.indexOf(n) }))
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx)
      .map((x) => GRAPH_COLORS[x.n]);
  }
  // POP単一線の実グラデ（画像から抽出。デザイン共通の7カラーバリアント）
  const POP_PALETTES: Record<string, string[]> = {
    "cool-violet": ["#2ABDFF", "#4388FF", "#6268FF", "#8656FF", "#AE48F6", "#DC3EE2"],
    "cpu-pop-heat": ["#63F197", "#BEFD21", "#E8F529", "#FFD22A", "#FF9824", "#FF5C4C"],
    "cream-accent": ["#AEEDE4", "#3FE7F8", "#42ECC5", "#8FF85A", "#C5DC3F", "#E67B95"],
    "cyan-lime-yellow": ["#3DEBCB", "#6EF388", "#A2FB40", "#C3FC22", "#D8F826", "#EEF42A"],
    "gpu-violet-pop": ["#35AFFF", "#536FFF", "#8457FF", "#BB45F0", "#F737D6", "#FF5A73"],
    "lime-hot": ["#D2FA25", "#F3F32B", "#FFD62B", "#FFAC26", "#FF8031", "#FF5155"],
    "pink-orange": ["#FF4BAA", "#FF6775", "#FF843D", "#FF9F25", "#FFBC28", "#FFDA2B"],
  };
  function findUpload(): string | undefined {
    return pickSensor(sensors.list, "", ["上り", "アップロード", "送信", "Upload", "UL"])?.id;
  }

  // 線グラフのスタイル＋色を選択中GraphLineへ適用（未選択なら新規）
  function applyGraph(file: string, setName: string): void {
    let item = editor.selected;
    if (!item || item.kind !== "GraphLine") {
      item = createItem("GraphLine", { x: 80, y: 80 });
      item.rect.w = 340; item.rect.h = 112; item.unit = "B/s"; item.autoUnit = true; item.bgOpacity = 0.2;
      editor.panel.items.push(item);
      editor.selectedId = item.id;
    }
    const style = styleFromName(setName);
    const pop = isPop(setName);
    const dual = style.startsWith("dual");
    item.graphStyle = style;
    if (dual) {
      const [c1, c2] = colorsFromFile(file);
      item.style.color = c1; item.color2 = c2; item.graphColors = undefined;
      if (!item.sensorSrc2) item.sensorSrc2 = findUpload();
    } else if (pop) {
      // 画像から抽出した実グラデ（カラーバリアントで引く）。無ければ名前から拾う。
      const key = Object.keys(POP_PALETTES).find((k) => file.toLowerCase().includes(k) || setName.toLowerCase().includes(k));
      const pal = (key && POP_PALETTES[key]) || allColorsFromFile(file);
      item.graphColors = pal.length >= 2 ? pal : undefined;
      item.style.color = pal[0] ?? "#00d2c4";
      item.color2 = pal[pal.length - 1] ?? "#ff3484";
    } else {
      item.style.color = colorFromFile(file); item.graphColors = undefined;
    }
    item.lineWidth = pop ? 3.5 : undefined;
    item.lineGradient = pop && !dual;
    editor.bumpStructure();
  }

  const thumb = (s: AssetSet) => s.files[Math.floor(s.files.length / 2)] ?? s.files[0];

  function setBackground(path: string): void {
    editor.panel.background = path;
    editor.bumpStructure();
  }
  function clearBackground(): void {
    editor.panel.background = undefined;
    editor.bumpStructure();
  }

  // セットの画像群を選択中ゲージに割当（未選択なら新規ゲージ作成）
  function assignGauge(set: AssetSet, isBar: boolean): void {
    let item = editor.selected;
    if (!item || item.kind !== "Gauge") {
      item = createItem("Gauge", { x: 80, y: 80 });
      if (isBar) { item.rect.w = 320; item.rect.h = 48; }
      else { item.rect.w = 118; item.rect.h = 118; }
      editor.panel.items.push(item);
      editor.selectedId = item.id;
    }
    item.gauge = { mode: "StateFrames", frames: set.files };
    editor.bumpStructure();
  }
</script>

<div class="lib">
  <div class="head">
    <strong>アセット</strong>
    <button onclick={() => { library.refresh(); refreshImages(); }}>更新</button>
    <button onclick={() => library.openFolder()}>Assetsを開く</button>
    <button onclick={() => invoke("open_images_dir")}>画像を開く</button>
    <button onclick={clearBackground}>背景クリア</button>
    <span class="msg">{library.msg}</span>
    {#if editor.selected?.kind === "Gauge"}<span class="hint">→ 選択中ゲージに割当</span>{/if}
  </div>

  <div class="scroll">
    {#if library.sets.length === 0}
      <div class="empty">
        Assets が空です。「Assetsを開く」で開いて、アセットのフォルダ（セット）を入れてから「更新」を押してください。
        パック丸ごと入れてもOK（中の画像フォルダを自動でセットとして拾います）。
      </div>
    {/if}

    <section>
      <div class="label">画像（1枚絵）— クリックで配置／選択中の画像に割当</div>
      {#if images.length}
        <div class="grid">
          {#each images as f}
            <button class="cell sq" title={fileName(f)} onclick={() => assignImage(f)}>
              <img src={convertFileSrc(f)} alt={fileName(f)} />
              <span class="cap">{fileName(f)}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="empty">image フォルダが空です。「画像を開く」でフォルダを開いてPNG等を入れ、「更新」を押してください。</div>
      {/if}
    </section>

    {#if groups.length}
      <div class="tabs">
        {#each groups as g}
          <button class="tab" class:active={g === activeTab} onclick={() => (activeTab = g)}>{g}</button>
        {/each}
      </div>

      {#if tabBg.length}
        <section><div class="label">背景（クリックで背景に設定）</div>
          <div class="grid">
            {#each tabBg as c}{#each c.set.files as f}
              <button class="cell wide" title="背景に設定" onclick={() => setBackground(f)}><img src={convertFileSrc(f)} alt="bg" /></button>
            {/each}{/each}
          </div>
        </section>
      {/if}
      {#if tabCircle.length}
        <section><div class="label">丸ゲージ（選択中ゲージに割当／未選択は新規）</div>
          <div class="grid">
            {#each tabCircle as c}
              <button class="cell sq" title={c.leaf} onclick={() => assignGauge(c.set, false)}><img src={convertFileSrc(thumb(c.set))} alt={c.leaf} /><span class="cap">{c.leaf}</span></button>
            {/each}
          </div>
        </section>
      {/if}
      {#if tabHorizontal.length}
        <section><div class="label">棒ゲージ</div>
          <div class="grid">
            {#each tabHorizontal as c}
              <button class="cell wide" title={c.leaf} onclick={() => assignGauge(c.set, true)}><img src={convertFileSrc(thumb(c.set))} alt={c.leaf} /><span class="cap">{c.leaf}</span></button>
            {/each}
          </div>
        </section>
      {/if}
      {#if tabGraph.length}
        <section><div class="label">線グラフ（選択中の線グラフにスタイル＋色を適用）</div>
          {#each tabGraph as c}
            <div class="subgroup"><span class="sub">{c.leaf}</span>
              <div class="grid">
                {#each c.set.files as f}
                  <button class="cell wide" title="{c.leaf} / {fileName(f)}" onclick={() => applyGraph(f, c.set.name)}><img src={convertFileSrc(f)} alt="graph" /></button>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}
      {#if tabFrame.length}
        <section><div class="label">枠（クリックで枠画像を配置）</div>
          <div class="grid">
            {#each tabFrame as c}{#each c.set.files as f}
              <button class="cell sq" title={fileName(f)} onclick={() => assignImage(f)}><img src={convertFileSrc(f)} alt="frame" /></button>
            {/each}{/each}
          </div>
        </section>
      {/if}
    {:else if library.sets.length}
      <div class="empty">認識できる素材（背景／連番ゲージ／線グラフ／枠）が見つかりませんでした。</div>
    {/if}
  </div>
</div>

<style>
  .lib { background: #141414; border-top: 1px solid #2a2a2a; color: #ccc; display: flex; flex-direction: column; height: 100%; }
  .head { display: flex; align-items: center; gap: 8px; padding: 5px 8px; flex: 0 0 auto; border-bottom: 1px solid #222; }
  .head button { padding: 3px 10px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .msg { color: #00ffcc; font-size: 12px; }
  .hint { color: #8ab; font-size: 12px; }
  .scroll { flex: 1 1 auto; overflow-y: auto; padding: 4px 8px 10px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 6px; position: sticky; top: 0; background: #141414; padding: 3px 0; z-index: 1; }
  .tab { padding: 3px 12px; background: #222; color: #bbb; border: 1px solid #3a3a3a; cursor: pointer; font-size: 12px; }
  .tab.active { background: #00d2c4; color: #042; border-color: #00d2c4; }
  section { margin: 2px 0 8px; }
  .label { font-size: 11px; color: #7d8; margin: 6px 0 3px; position: sticky; top: 0; background: #141414; padding: 2px 0; }
  .subgroup { margin: 2px 0 4px; }
  .sub { font-size: 10px; color: #889; }
  .grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .cell { padding: 2px; background: #1c1c1c; border: 1px solid #333; cursor: pointer; display: flex; flex-direction: column; align-items: center; overflow: hidden; }
  .cell:hover { border-color: #00ffcc; }
  .cell img { object-fit: contain; display: block; background: #000; }
  .cell.sq { width: 72px; }
  .cell.sq img { width: 66px; height: 56px; }
  .cell.wide { width: 116px; }
  .cell.wide img { width: 110px; height: 34px; }
  .cap { font-size: 10px; color: #9aa; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: #888; font-size: 12px; padding: 10px; line-height: 1.5; }
</style>
