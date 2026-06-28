<script lang="ts">
  import { onMount } from "svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { library, type AssetSet } from "$lib/assets/library.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { createItem } from "$lib/model/panel";

  // 当面はパックの絶対パス固定（後でフォルダ選択ダイアログに）
  const AIDA64_ASSETS = "D:/VSCode/PC Status/aida64-skin-final-assets-v3";

  onMount(() => { library.refresh(); });

  const backgrounds = $derived(library.sets.find((s) => s.name === "backgrounds"));
  const rounds = $derived(library.sets.filter((s) => s.name.startsWith("round/")));

  // 横バーは スタイル(barcode/scanline/...) ごとにまとめ、中に色を並べる
  const barGroups = $derived.by(() => {
    const byStyle = new Map<string, { set: AssetSet; color: string }[]>();
    for (const s of library.sets) {
      if (!s.name.startsWith("bar/")) continue;
      const rest = s.name.slice("bar/".length); // 例 "barcode-cream"
      const dash = rest.lastIndexOf("-");
      const style = dash >= 0 ? rest.slice(0, dash) : rest;
      const color = dash >= 0 ? rest.slice(dash + 1) : "";
      if (!byStyle.has(style)) byStyle.set(style, []);
      byStyle.get(style)!.push({ set: s, color });
    }
    return [...byStyle.entries()];
  });

  function setBackground(path: string): void {
    editor.panel.background = path;
    editor.bumpStructure();
  }

  function assignGauge(set: AssetSet): void {
    let item = editor.selected;
    if (!item || item.kind !== "Gauge") {
      item = createItem("Gauge", { x: 80, y: 80 });
      if (set.name.startsWith("bar/")) { item.rect.w = 320; item.rect.h = 48; }
      else { item.rect.w = 118; item.rect.h = 118; }
      editor.panel.items.push(item);
      editor.selectedId = item.id;
    }
    item.gauge = { mode: "StateFrames", frames: set.files };
    editor.bumpStructure();
  }

  const thumb = (s: AssetSet) => s.files[Math.floor(s.files.length / 2)] ?? s.files[0];
  const roundLabel = (s: AssetSet) => s.name.replace("round/", "").replace(/gradient-/, "");
</script>

<div class="lib">
  <div class="head">
    <strong>アセット</strong>
    <button onclick={() => library.importAida64(AIDA64_ASSETS)} disabled={library.loading}>AIDA64パック取込</button>
    <button onclick={() => library.refresh()}>更新</button>
    <button onclick={() => library.openFolder()}>Assetsを開く</button>
    <span class="msg">{library.msg}</span>
    {#if editor.selected?.kind === "Gauge"}<span class="hint">→ 選択中ゲージに割当</span>{/if}
  </div>

  <div class="scroll">
    {#if backgrounds && backgrounds.files.length}
      <section>
        <div class="label">背景</div>
        <div class="grid">
          {#each backgrounds.files as f}
            <button class="cell wide" title="背景に設定" onclick={() => setBackground(f)}>
              <img src={convertFileSrc(f)} alt="bg" />
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if rounds.length}
      <section>
        <div class="label">丸ゲージ</div>
        <div class="grid">
          {#each rounds as s}
            <button class="cell sq" title={s.name} onclick={() => assignGauge(s)}>
              <img src={convertFileSrc(thumb(s))} alt={s.name} />
              <span class="cap">{roundLabel(s)}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#each barGroups as [style, items]}
      <section>
        <div class="label">横バー · {style}</div>
        <div class="grid">
          {#each items as it}
            <button class="cell wide" title={it.set.name} onclick={() => assignGauge(it.set)}>
              <img src={convertFileSrc(thumb(it.set))} alt={it.set.name} />
              <span class="cap">{it.color}</span>
            </button>
          {/each}
        </div>
      </section>
    {/each}

    {#if library.sets.length === 0}
      <div class="empty">まだ取り込まれていません。「AIDA64パック取込」を押してください。</div>
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
  section { margin: 2px 0 8px; }
  .label { font-size: 11px; color: #7d8; margin: 6px 0 3px; position: sticky; top: 0; background: #141414; padding: 2px 0; }
  .grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .cell { padding: 2px; background: #1c1c1c; border: 1px solid #333; cursor: pointer; display: flex; flex-direction: column; align-items: center; overflow: hidden; }
  .cell:hover { border-color: #00ffcc; }
  .cell img { object-fit: contain; display: block; background: #000; }
  .cell.sq { width: 72px; }
  .cell.sq img { width: 66px; height: 56px; }
  .cell.wide { width: 116px; }
  .cell.wide img { width: 110px; height: 34px; }
  .cap { font-size: 10px; color: #9aa; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: #777; font-size: 12px; padding: 10px; }
</style>
