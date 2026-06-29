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
    | "dual-bars" | "dual-dotted" | "dual-scanband";

  onMount(() => { library.refresh(); });

  // GUI表示用のカテゴリ推測（フォルダ名から。フォルダ自体はいじらない）
  type Cat = "bg" | "round" | "bar" | "graph" | "other";
  function cat(name: string): Cat {
    const n = name.toLowerCase();
    // 線グラフ（network/line-graph-assets/... 単一・2本とも）
    if (n.includes("line-graph")) return "graph";
    if (n.includes("background") || n.includes("backdrop") || /(^|\/)bg(\/|$)/.test(n)) return "bg";
    if (n.includes("round") || n.includes("circle") || n.includes("dial")) return "round";
    if (n.includes("horizontal") || n.includes("bar")) return "bar";
    return "other";
  }
  const bgSets = $derived(library.sets.filter((s) => cat(s.name) === "bg"));
  const roundSets = $derived(library.sets.filter((s) => cat(s.name) === "round"));
  const barSets = $derived(library.sets.filter((s) => cat(s.name) === "bar"));
  const graphSets = $derived(library.sets.filter((s) => cat(s.name) === "graph"));
  const otherSets = $derived(library.sets.filter((s) => cat(s.name) === "other"));

  // 線グラフスタイル: フォルダ名→スタイル、ファイル名→色
  const GRAPH_COLORS: Record<string, string> = {
    cream: "#eee8d6", cyan: "#00d2c4", lime: "#6af62a", pink: "#ff3484", purple: "#8652ff", yellow: "#f4d35e",
  };
  function styleFromName(name: string): GraphStyle {
    const n = name.toLowerCase();
    if (n.includes("dual")) {
      if (n.includes("crossing")) return "dual-crossing";
      if (n.includes("mirrored")) return "dual-mirrored";
      if (n.includes("filled-split")) return "dual-filled-split";
      if (n.includes("bars")) return "dual-bars";
      if (n.includes("dotted")) return "dual-dotted";
      if (n.includes("scanband")) return "dual-scanband";
      return "dual-basic";
    }
    if (n.includes("dot-matrix")) return "dots";
    if (n.includes("filled-scan")) return "filled";
    if (n.includes("spike-trace")) return "spike";
    return "line";
  }
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
    return [hits[0] ? GRAPH_COLORS[hits[0].n] : "#00d2c4", hits[1] ? GRAPH_COLORS[hits[1].n] : "#ff3484"];
  }
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
    item.graphStyle = style;
    if (style.startsWith("dual")) {
      const [c1, c2] = colorsFromFile(file);
      item.style.color = c1; item.color2 = c2;
      if (!item.sensorSrc2) item.sensorSrc2 = findUpload();
    } else {
      item.style.color = colorFromFile(file);
    }
    editor.bumpStructure();
  }

  const leaf = (name: string) => name.split("/").pop() ?? name;
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
  function assignGauge(set: AssetSet): void {
    let item = editor.selected;
    if (!item || item.kind !== "Gauge") {
      item = createItem("Gauge", { x: 80, y: 80 });
      if (cat(set.name) === "bar") { item.rect.w = 320; item.rect.h = 48; }
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

    {#if graphSets.length}
      <section>
        <div class="label">線グラフ（選択中の線グラフにスタイル＋色を適用）</div>
        {#each graphSets as s}
          <div class="subgroup">
            <span class="sub">{leaf(s.name)}</span>
            <div class="grid">
              {#each s.files as f}
                <button class="cell wide" title="{leaf(s.name)} / {f.split('/').pop()}" onclick={() => applyGraph(f, s.name)}>
                  <img src={convertFileSrc(f)} alt="graph" />
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#each [{ t: "背景", sets: bgSets, bg: true }, { t: "丸ゲージ", sets: roundSets, bg: false }, { t: "横バー", sets: barSets, bg: false }, { t: "その他", sets: otherSets, bg: false }] as group}
      {#if group.sets.length}
        <section>
          <div class="label">{group.t}</div>
          <div class="grid">
            {#if group.bg}
              {#each group.sets as s}
                {#each s.files as f}
                  <button class="cell wide" title="背景に設定" onclick={() => setBackground(f)}>
                    <img src={convertFileSrc(f)} alt="bg" />
                  </button>
                {/each}
              {/each}
            {:else}
              {#each group.sets as s}
                <button class="cell {cat(s.name) === 'bar' ? 'wide' : 'sq'}" title={s.name} onclick={() => assignGauge(s)}>
                  <img src={convertFileSrc(thumb(s))} alt={s.name} />
                  <span class="cap">{leaf(s.name)}</span>
                </button>
              {/each}
            {/if}
          </div>
        </section>
      {/if}
    {/each}
  </div>
</div>

<style>
  .lib { background: #141414; border-top: 1px solid #2a2a2a; color: #ccc; display: flex; flex-direction: column; height: 100%; }
  .head { display: flex; align-items: center; gap: 8px; padding: 5px 8px; flex: 0 0 auto; border-bottom: 1px solid #222; }
  .head button { padding: 3px 10px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .msg { color: #00ffcc; font-size: 12px; }
  .hint { color: #8ab; font-size: 12px; }
  .scroll { flex: 1 1 auto; overflow-y: auto; padding: 4px 8px 10px; }
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
