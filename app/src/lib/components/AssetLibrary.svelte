<script lang="ts">
  import { onMount } from "svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { library, type AssetSet } from "$lib/assets/library.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { createItem } from "$lib/model/panel";

  onMount(() => { library.refresh(); });

  // GUI表示用のカテゴリ推測（フォルダ名から。フォルダ自体はいじらない）
  type Cat = "bg" | "round" | "bar" | "graph" | "other";
  function cat(name: string): Cat {
    const n = name.toLowerCase();
    // 単一線グラフ（network/line-graph-assets/Single/...）。dualは Phase B でその他扱い
    if (n.includes("line-graph") && n.includes("single")) return "graph";
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
  function styleFromName(name: string): "line" | "filled" | "dots" | "spike" {
    const n = name.toLowerCase();
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

  // 線グラフのスタイル＋色を選択中GraphLineへ適用（未選択なら新規）
  function applyGraph(file: string, setName: string): void {
    let item = editor.selected;
    if (!item || item.kind !== "GraphLine") {
      item = createItem("GraphLine", { x: 80, y: 80 });
      item.rect.w = 340; item.rect.h = 112; item.unit = "B/s"; item.autoUnit = true; item.bgOpacity = 0.2;
      editor.panel.items.push(item);
      editor.selectedId = item.id;
    }
    item.graphStyle = styleFromName(setName);
    item.style.color = colorFromFile(file);
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
    <button onclick={() => library.refresh()}>更新</button>
    <button onclick={() => library.openFolder()}>Assetsを開く</button>
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
