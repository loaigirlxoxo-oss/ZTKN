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
  const gaugeSets = $derived(library.sets.filter((s) => s.name.startsWith("round--") || s.name.startsWith("bar--")));

  function setBackground(path: string): void {
    editor.panel.background = path;
    editor.bumpStructure();
  }

  // 選択中ゲージに状態セットを割当。ゲージ未選択なら新規ゲージを作って割当。
  function assignGauge(set: AssetSet): void {
    let item = editor.selected;
    if (!item || item.kind !== "Gauge") {
      item = createItem("Gauge", { x: 80, y: 80 });
      if (set.name.startsWith("bar--")) { item.rect.w = 320; item.rect.h = 48; }
      else { item.rect.w = 118; item.rect.h = 118; }
      editor.panel.items.push(item);
      editor.selectedId = item.id;
    }
    item.gauge = { mode: "StateFrames", frames: set.files };
    editor.bumpStructure();
  }

  const thumb = (s: AssetSet) => s.files[Math.floor(s.files.length / 2)] ?? s.files[0];
</script>

<div class="lib">
  <div class="head">
    <strong>アセット</strong>
    <button onclick={() => library.importAida64(AIDA64_ASSETS)} disabled={library.loading}>AIDA64パック取込</button>
    <button onclick={() => library.refresh()}>更新</button>
    <span class="msg">{library.msg}</span>
  </div>

  {#if backgrounds && backgrounds.files.length}
    <div class="group">
      <span class="label">背景（クリックでパネルに設定）</span>
      <div class="row">
        {#each backgrounds.files as f}
          <button class="cell" title="背景に設定" onclick={() => setBackground(f)}>
            <img src={convertFileSrc(f)} alt="bg" />
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="group">
    <span class="label">ゲージ状態セット（選択中ゲージに割当／未選択なら新規）</span>
    <div class="row">
      {#each gaugeSets as s}
        <button class="cell named" title={s.name} onclick={() => assignGauge(s)}>
          <img src={convertFileSrc(thumb(s))} alt={s.name} />
          <span class="cap">{s.name}</span>
        </button>
      {/each}
      {#if gaugeSets.length === 0}
        <span class="empty">まだ取り込まれていません。「AIDA64パック取込」を押してください。</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .lib { background: #141414; border-top: 1px solid #2a2a2a; color: #ccc; padding: 6px 8px; overflow-y: auto; }
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .head button { padding: 3px 10px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .msg { color: #00ffcc; font-size: 12px; }
  .group { margin: 4px 0; }
  .label { font-size: 11px; color: #888; }
  .row { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0; }
  .cell { flex: 0 0 auto; padding: 2px; background: #1c1c1c; border: 1px solid #333; cursor: pointer; display: flex; flex-direction: column; align-items: center; overflow: hidden; }
  .cell:hover { border-color: #00ffcc; }
  /* 背景サムネ：固定枠に contain（はみ出さない） */
  .cell img { width: 128px; height: 44px; object-fit: contain; display: block; background: #000; }
  /* ゲージセットのサムネ：固定枠に contain（横長バーでも崩れない） */
  .cell.named { width: 92px; }
  .cell.named img { width: 86px; height: 56px; object-fit: contain; }
  .cap { font-size: 10px; color: #9aa; max-width: 86px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: #777; font-size: 12px; padding: 8px; }
</style>
