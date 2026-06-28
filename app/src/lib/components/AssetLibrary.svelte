<script lang="ts">
  import { onMount } from "svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { library, type AssetSet } from "$lib/assets/library.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { createItem } from "$lib/model/panel";

  onMount(() => { library.refresh(); });

  // GUI表示用のカテゴリ推測（フォルダ名から。フォルダ自体はいじらない）
  type Cat = "bg" | "round" | "bar" | "other";
  function cat(name: string): Cat {
    const n = name.toLowerCase();
    if (n.includes("background") || n.includes("backdrop") || /(^|\/)bg(\/|$)/.test(n)) return "bg";
    if (n.includes("round") || n.includes("circle") || n.includes("dial")) return "round";
    if (n.includes("horizontal") || n.includes("bar")) return "bar";
    return "other";
  }
  const bgSets = $derived(library.sets.filter((s) => cat(s.name) === "bg"));
  const roundSets = $derived(library.sets.filter((s) => cat(s.name) === "round"));
  const barSets = $derived(library.sets.filter((s) => cat(s.name) === "bar"));
  const otherSets = $derived(library.sets.filter((s) => cat(s.name) === "other"));

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
