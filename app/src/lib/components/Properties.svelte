<script lang="ts">
  import { editor } from "$lib/editor/editorState.svelte";
  import { DUMMY_SENSORS } from "$lib/sensors/dummy";

  const item = $derived(editor.selected);

  // プロパティ変更を Konva 再描画へ伝える（フォントは選択中アイテムのみ変更＝独立）
  function changed(): void {
    editor.bumpStructure();
  }

  function toggleBold(e: Event): void {
    if (!item) return;
    item.style.fontWeight = (e.target as HTMLInputElement).checked ? "bold" : "normal";
    changed();
  }
</script>

{#if item}
  <div class="props">
    <div class="kind">{item.kind}</div>
    <label>X <input type="number" bind:value={item.rect.x} oninput={changed} /></label>
    <label>Y <input type="number" bind:value={item.rect.y} oninput={changed} /></label>
    <label>W <input type="number" bind:value={item.rect.w} oninput={changed} /></label>
    <label>H <input type="number" bind:value={item.rect.h} oninput={changed} /></label>
    <label>角度 <input type="number" bind:value={item.rotation} oninput={changed} /></label>
    <label>不透明度 <input type="range" min="0" max="1" step="0.05" bind:value={item.opacity} oninput={changed} /></label>
    <label>フォント
      <select bind:value={item.style.fontFamily} onchange={changed}>
        <!-- Windows 標準同梱で視認差が大きいものに限定（未インストールだとフォールバックで差が出ない） -->
        <option>Segoe UI</option>
        <option>Arial</option>
        <option>Consolas</option>
        <option>Times New Roman</option>
        <option>Comic Sans MS</option>
        <option>Impact</option>
        <option>Meiryo</option>
        <option>MS Gothic</option>
      </select>
    </label>
    <label>サイズ <input type="number" bind:value={item.style.fontSize} oninput={changed} /></label>
    <label>太字 <input type="checkbox" checked={item.style.fontWeight === "bold"} onchange={toggleBold} /></label>
    <label>色 <input type="color" bind:value={item.style.color} oninput={changed} /></label>
    <label>format <input bind:value={item.format} oninput={changed} /></label>
    {#if item.range}
      <label>min <input type="number" bind:value={item.range[0]} oninput={changed} /></label>
      <label>max <input type="number" bind:value={item.range[1]} oninput={changed} /></label>
    {/if}
    <label>センサー
      <select bind:value={item.sensorSrc} onchange={changed}>
        <option value={undefined}>(なし)</option>
        {#each DUMMY_SENSORS as s}<option value={s.id}>{s.label}</option>{/each}
      </select>
    </label>
    <button class="del" onclick={() => editor.deleteSelected()}>削除</button>
  </div>
{:else}
  <div class="props muted">アイテムを選択</div>
{/if}

<style>
  .props { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #161616; color: #ccc; width: 210px; }
  .kind { color: #00ffcc; font-size: 13px; margin-bottom: 4px; }
  .muted { opacity: 0.5; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12px; }
  input, select { background: #222; color: #ddd; border: 1px solid #3a3a3a; max-width: 120px; }
  .del { margin-top: 8px; padding: 4px; background: #5a2222; color: #fdd; border: 1px solid #7a3333; cursor: pointer; }
</style>
