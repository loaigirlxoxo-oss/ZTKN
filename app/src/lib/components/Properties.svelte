<script lang="ts">
  import { editor } from "$lib/editor/editorState.svelte";
  import { sensors, type LiveSensor } from "$lib/sensors/live.svelte";

  const item = $derived(editor.selected);

  // センサーをハードウェア別にグループ化（ピッカー表示用）
  const grouped = $derived.by(() => {
    const map = new Map<string, LiveSensor[]>();
    for (const s of sensors.list) {
      let arr = map.get(s.hw);
      if (!arr) { arr = []; map.set(s.hw, arr); }
      arr.push(s);
    }
    return [...map.entries()];
  });

  // プロパティ変更を Konva 再描画へ伝える（フォントは選択中アイテムのみ変更＝独立）
  function changed(): void {
    editor.bumpStructure();
  }

  function toggleBold(e: Event): void {
    if (!item) return;
    item.style.fontWeight = (e.target as HTMLInputElement).checked ? "bold" : "normal";
    changed();
  }

  // グラフの自動スケール ON/OFF（OFF=range固定でmin/max指定可）
  function toggleAuto(e: Event): void {
    if (!item) return;
    item.range = (e.target as HTMLInputElement).checked ? undefined : [0, 100];
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
    {#if item.kind === "GraphLine"}
      <label>単位
        <select bind:value={item.unit} onchange={changed}>
          <option value="">(なし)</option>
          <option value="%">%</option>
          <option value="°C">°C</option>
          <option value="MHz">MHz</option>
          <option value="RPM">RPM</option>
          <option value="W">W</option>
          <option value="bps">bps</option>
          <option value="Kbps">Kbps</option>
          <option value="Mbps">Mbps</option>
          <option value="Gbps">Gbps</option>
          <option value="B/s">B/s</option>
          <option value="KB/s">KB/s</option>
          <option value="MB/s">MB/s</option>
          <option value="GB/s">GB/s</option>
        </select>
      </label>
      <label>単位を自動換算 <input type="checkbox" bind:checked={item.autoUnit} onchange={changed} /></label>
      <label>自動スケール <input type="checkbox" checked={!item.range} onchange={toggleAuto} /></label>
      <label>スケール表示 <input type="checkbox" bind:checked={item.showScale} onchange={changed} /></label>
      <label>スタイル
        <select bind:value={item.graphStyle} onchange={changed}>
          <option value="line">線(clean-wave)</option>
          <option value="filled">塗り(filled-scan)</option>
          <option value="dots">点(dot-matrix)</option>
          <option value="spike">スパイク(spike-trace)</option>
        </select>
      </label>
    {/if}
    {#if item.kind === "Gauge" || item.kind === "BarH" || item.kind === "BarV" || item.kind === "GraphLine"}
      <label>背景色 <input type="color" bind:value={item.bgColor} oninput={changed} /></label>
      <label>背景透過度 <input type="range" min="0" max="1" step="0.05" bind:value={item.bgOpacity} oninput={changed} /></label>
      <label>枠色 <input type="color" bind:value={item.frameColor} oninput={changed} /></label>
      <label>枠透過度 <input type="range" min="0" max="1" step="0.05" bind:value={item.frameOpacity} oninput={changed} /></label>
    {/if}
    {#if item.kind === "BarH" || item.kind === "BarV"}
      <label>2色グラデ <input type="checkbox" bind:checked={item.useGradient} onchange={changed} /></label>
      <label>色2 <input type="color" bind:value={item.gradColor} oninput={changed} /></label>
    {/if}
    {#if item.range}
      <label>min <input type="number" bind:value={item.range[0]} oninput={changed} /></label>
      <label>max <input type="number" bind:value={item.range[1]} oninput={changed} /></label>
    {/if}
    <label>センサー
      <select bind:value={item.sensorSrc} onchange={changed}>
        <option value={undefined}>(なし)</option>
        {#each grouped as [hw, arr]}
          <optgroup label={hw}>
            {#each arr as s}<option value={s.id}>{s.name} ({s.unit})</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <button class="del" onclick={() => editor.deleteSelected()}>削除</button>
  </div>
{:else}
  <div class="props muted">アイテムを選択</div>
{/if}

<style>
  /* エディタ行の高さ内で独立スクロール（ドロワーに押されて隠れないように） */
  .props { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #161616; color: #ccc; width: 210px; height: 100%; overflow-y: auto; box-sizing: border-box; flex: 0 0 auto; }
  .kind { color: #00ffcc; font-size: 13px; margin-bottom: 4px; }
  .muted { opacity: 0.5; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12px; }
  input, select { background: #222; color: #ddd; border: 1px solid #3a3a3a; max-width: 120px; }
  .del { margin-top: 8px; padding: 4px; background: #5a2222; color: #fdd; border: 1px solid #7a3333; cursor: pointer; }
</style>
