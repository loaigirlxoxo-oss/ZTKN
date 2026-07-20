<script lang="ts">
  import { editor } from "$lib/editor/editorState.svelte";
  import { sensors, type LiveSensor } from "$lib/sensors/live.svelte";
  import { pickLhm } from "$lib/sensors/match";
  import { formatForUnit } from "$lib/render/format";
  import { getImage, loadImage } from "$lib/render/images";
  import { fontStore, ensureFonts } from "$lib/fonts/installed.svelte";

  ensureFonts(); // インストール済みフォントを取得（多重防止済み）

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

  // センサー一覧の絞り込み（名前/ハード/単位/IDを部分一致）
  let sensorQuery = $state("");
  const filteredGroups = $derived.by(() => {
    const q = sensorQuery.trim().toLowerCase();
    if (!q) return grouped;
    const out: [string, LiveSensor[]][] = [];
    for (const [hw, arr] of grouped) {
      const f = arr.filter((s) => `${s.name} ${hw} ${s.unit} ${s.id}`.toLowerCase().includes(q));
      if (f.length) out.push([hw, f]);
    }
    return out;
  });

  // プロパティ変更を Konva 再描画へ伝える（フォントは選択中アイテムのみ変更＝独立）
  function changed(): void {
    editor.bumpStructure();
  }

  // 合算センサー「Total Power（CPU+GPU）」を表す特別な選択肢の値。実センサーIDと衝突しない。
  const SUM_POWER = "__sum_power__";
  // CPU電力＋GPU電力のセンサーIDを解決（テンプレ neon.ts と同じ基準）。
  function totalPowerIds(): string[] {
    const cpu = pickLhm(sensors.list, "CPU Package", "Power");
    const gpu = pickLhm(sensors.list, "GPU Package", "Power", "NVIDIA") ?? pickLhm(sensors.list, "GPU Package", "Power");
    return [cpu?.id, gpu?.id].filter(Boolean) as string[];
  }
  // ピッカーの選択値：合算中は SUM_POWER、それ以外は sensorSrc。
  const sensorSelectValue = $derived(item?.sensorSum?.length ? SUM_POWER : (item?.sensorSrc ?? ""));

  // センサーを選んだら反映。合算/単一/なし を排他で設定し、単位から format を自動設定（SensorTextのみ）。
  function sensorChanged(e: Event): void {
    if (!item) return;
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === SUM_POWER) {
      item.sensorSum = totalPowerIds();
      item.sensorSrc = undefined;
      if (item.kind === "SensorText") item.format = formatForUnit("W");
    } else {
      item.sensorSum = undefined;
      item.sensorSrc = v === "" ? undefined : v;
      if (item.kind === "SensorText") {
        const s = sensors.list.find((x) => x.id === item.sensorSrc);
        // リセット時刻(epoch)は %t＝残り時間カウントダウンで表示。通常センサーは単位から数値書式。
        item.format = s?.type === "Reset" ? "残り %t" : formatForUnit(s?.unit);
      }
    }
    changed();
  }

  // クロップ時に縦横比を保つ：幅は保持し、高さを切り出し領域のアスペクトへ合わせる（歪み防止）
  function fitCropAspect(): void {
    const it = item;
    if (!it || it.kind !== "Image" || !it.asset) return;
    const img = getImage(it.asset);
    if (!img) { loadImage(it.asset).then(() => { fitCropAspect(); changed(); }).catch(() => {}); return; }
    const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    const cw = nw * (1 - (it.cropLeft ?? 0) - (it.cropRight ?? 0));
    const ch = nh * (1 - (it.cropTop ?? 0) - (it.cropBottom ?? 0));
    if (cw > 0 && ch > 0) it.rect.h = Math.max(8, Math.round(it.rect.w * (ch / cw)));
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
    <div class="kind">{item.kind}{#if editor.selectedIds.length > 1} ・{editor.selectedIds.length}個選択{/if}</div>
    <label>X <input type="number" bind:value={item.rect.x} oninput={changed} /></label>
    <label>Y <input type="number" bind:value={item.rect.y} oninput={changed} /></label>
    <label>W <input type="number" bind:value={item.rect.w} oninput={changed} /></label>
    <label>H <input type="number" bind:value={item.rect.h} oninput={changed} /></label>
    <label>角度 <input type="number" bind:value={item.rotation} oninput={changed} /></label>
    <label>不透明度 <input type="range" min="0" max="1" step="0.05" bind:value={item.opacity} oninput={changed} /></label>
    <label>フォント
      <select bind:value={item.style.fontFamily} onchange={changed}>
        <!-- Windows にインストール済みの全フォント（Rust の list_fonts 経由）。未取得時は FALLBACK -->
        {#each fontStore.list as f}<option value={f}>{f}</option>{/each}
      </select>
    </label>
    <label>サイズ <input type="number" bind:value={item.style.fontSize} oninput={changed} /></label>
    <label>太字 <input type="checkbox" checked={item.style.fontWeight === "bold"} onchange={toggleBold} /></label>
    <label>色 <input type="color" bind:value={item.style.color} oninput={changed} /></label>
    <label>format <input bind:value={item.format} oninput={changed} /></label>
    {#if item.kind === "Label" || item.kind === "SensorText" || item.kind === "DateTime"}
      {#if item.kind === "SensorText" || item.kind === "DateTime"}
        <label>揃え(基準)
          <select value={item.style.align} onchange={(e) => { item.style.align = e.currentTarget.value as "left" | "center" | "right"; changed(); }}>
            <option value="left">左（左端固定）</option>
            <option value="center">中央（中心固定）</option>
            <option value="right">右（右端固定）</option>
          </select>
        </label>
      {/if}
      <label>フチ色 <input type="color" value={item.style.strokeColor ?? "#000000"} oninput={(e) => { item.style.strokeColor = e.currentTarget.value; changed(); }} /></label>
      <label>フチ太さ <input type="number" min="0" step="0.5" value={item.style.strokeWidth ?? 0} oninput={(e) => { item.style.strokeWidth = +e.currentTarget.value; changed(); }} /></label>
      <label>フチぼかし(グロー) <input type="number" min="0" value={item.style.glowBlur ?? 0} oninput={(e) => { item.style.glowBlur = +e.currentTarget.value; changed(); }} /></label>
      <label>影色 <input type="color" value={item.style.shadowColor ?? "#000000"} oninput={(e) => { item.style.shadowColor = e.currentTarget.value; changed(); }} /></label>
      <label>影ぼかし(広がり) <input type="number" min="0" value={item.style.shadowBlur ?? 0} oninput={(e) => { item.style.shadowBlur = +e.currentTarget.value; changed(); }} /></label>
      <label>影の濃さ <input type="range" min="0" max="1" step="0.05" value={item.style.shadowOpacity ?? 1} oninput={(e) => { item.style.shadowOpacity = +e.currentTarget.value; changed(); }} /></label>
      <label>影X <input type="number" value={item.style.shadowOffsetX ?? 0} oninput={(e) => { item.style.shadowOffsetX = +e.currentTarget.value; changed(); }} /></label>
      <label>影Y <input type="number" value={item.style.shadowOffsetY ?? 0} oninput={(e) => { item.style.shadowOffsetY = +e.currentTarget.value; changed(); }} /></label>
    {/if}
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
      <label>値倍率 <input type="number" step="0.1" bind:value={item.valueScale} oninput={changed} placeholder="1" /></label>
      <label>自動スケール <input type="checkbox" checked={!item.range} onchange={toggleAuto} /></label>
      <label>スケール表示 <input type="checkbox" bind:checked={item.showScale} onchange={changed} /></label>
      <label>線の太さ <input type="number" min="0.5" step="0.5" bind:value={item.lineWidth} oninput={changed} placeholder="1.5" /></label>
      <label>線グラデ(色→色2) <input type="checkbox" bind:checked={item.lineGradient} onchange={changed} /></label>
      <label>スタイル
        <select bind:value={item.graphStyle} onchange={changed}>
          <optgroup label="単一線">
            <option value="line">線(clean-wave)</option>
            <option value="filled">塗り(filled-scan)</option>
            <option value="dots">点(dot-matrix)</option>
            <option value="spike">スパイク(spike-trace)</option>
          </optgroup>
          <optgroup label="2本(下り+上り)">
            <option value="dual-basic">basic(2本線)</option>
            <option value="dual-crossing">crossing(交差)</option>
            <option value="dual-mirrored">mirrored(上下対称)</option>
            <option value="dual-filled-split">filled-split(塗り分け)</option>
            <option value="dual-bars">bars-trace(棒+線)</option>
            <option value="dual-dotted">dotted(点線)</option>
            <option value="dual-scanband">scanband(帯)</option>
            <option value="dual-linedot">linedot(線+点)</option>
          </optgroup>
        </select>
      </label>
      {#if item.graphStyle?.startsWith("dual")}
        <label>第2センサー(上り)
          <select bind:value={item.sensorSrc2} onchange={changed}>
            <option value={undefined}>(なし)</option>
            {#each filteredGroups as [hw, arr]}
              <optgroup label={hw}>
                {#each arr as s}<option value={s.id}>{s.name} ({s.unit})</option>{/each}
              </optgroup>
            {/each}
          </select>
        </label>
        <label>色2 <input type="color" bind:value={item.color2} oninput={changed} /></label>
      {/if}
    {/if}
    {#if item.kind === "Gauge" || item.kind === "BarH" || item.kind === "BarV" || item.kind === "GraphLine" || item.kind === "Box"}
      <label>{item.kind === "Box" ? "塗り色" : "背景色"} <input type="color" bind:value={item.bgColor} oninput={changed} /></label>
      <label>{item.kind === "Box" ? "塗り透過度" : "背景透過度"} <input type="range" min="0" max="1" step="0.05" bind:value={item.bgOpacity} oninput={changed} /></label>
      <label>枠色 <input type="color" bind:value={item.frameColor} oninput={changed} /></label>
      <label>枠透過度 <input type="range" min="0" max="1" step="0.05" bind:value={item.frameOpacity} oninput={changed} /></label>
    {/if}
    {#if item.kind === "Box"}
      <label>枠太さ <input type="number" min="0" bind:value={item.borderWidth} oninput={changed} /></label>
      <label>角丸 <input type="number" min="0" bind:value={item.cornerRadius} oninput={changed} /></label>
    {/if}
    {#if item.kind === "Line"}
      <label>太さ <input type="number" min="1" bind:value={item.lineWidth} oninput={changed} /></label>
    {/if}
    {#if item.kind === "Image"}
      <label>左トリム <input type="range" min="0" max="0.95" step="0.01" value={item.cropLeft ?? 0} oninput={(e) => { item.cropLeft = +e.currentTarget.value; fitCropAspect(); changed(); }} /></label>
      <label>右トリム <input type="range" min="0" max="0.95" step="0.01" value={item.cropRight ?? 0} oninput={(e) => { item.cropRight = +e.currentTarget.value; fitCropAspect(); changed(); }} /></label>
      <label>上トリム <input type="range" min="0" max="0.95" step="0.01" value={item.cropTop ?? 0} oninput={(e) => { item.cropTop = +e.currentTarget.value; fitCropAspect(); changed(); }} /></label>
      <label>下トリム <input type="range" min="0" max="0.95" step="0.01" value={item.cropBottom ?? 0} oninput={(e) => { item.cropBottom = +e.currentTarget.value; fitCropAspect(); changed(); }} /></label>
      <button onclick={() => { item.cropLeft = 0; item.cropRight = 0; item.cropTop = 0; item.cropBottom = 0; fitCropAspect(); changed(); }}>トリム解除</button>
    {/if}
    {#if item.kind === "BarH" || item.kind === "BarV" || item.kind === "Gauge"}
      <label>2色グラデ <input type="checkbox" bind:checked={item.useGradient} onchange={changed} /></label>
      <label>色2 <input type="color" bind:value={item.gradColor} oninput={changed} /></label>
    {/if}
    {#if item.range}
      <label>min <input type="number" bind:value={item.range[0]} oninput={changed} /></label>
      <label>max <input type="number" bind:value={item.range[1]} oninput={changed} /></label>
    {/if}
    {#if item.kind === "AlertList"}
      <label>対象
        <select value={item.sensorSrc ?? ""} onchange={(e) => { item.sensorSrc = e.currentTarget.value || undefined; changed(); }}>
          <option value="">全部（Claude+Codex）</option>
          <option value="claude">Claudeのみ</option>
          <option value="codex">Codexのみ</option>
        </select>
      </label>
    {:else}
      <label class="sensor-search">🔍 <input type="text" placeholder="センサー検索" bind:value={sensorQuery} /></label>
      <label>センサー
        <select value={sensorSelectValue} onchange={sensorChanged}>
          <option value="">(なし)</option>
          <option value={SUM_POWER}>★ Total Power（CPU+GPU合算）</option>
          {#each filteredGroups as [hw, arr]}
            <optgroup label={hw}>
              {#each arr as s}<option value={s.id}>{s.name} ({s.unit})</option>{/each}
            </optgroup>
          {/each}
        </select>
      </label>
    {/if}
    <div class="row">
      <button onclick={() => editor.duplicateSelected()} title="複製 (Ctrl+D)">複製</button>
      <button onclick={() => editor.bringToFront()} title="最前面へ">前面</button>
      <button onclick={() => editor.sendToBack()} title="最背面へ">背面</button>
    </div>
    <div class="row">
      <button class:on={item.flipX} onclick={() => { item.flipX = !item.flipX; changed(); }} title="左右反転（ミラー）">⇋ 左右反転</button>
      <button class:on={item.flipY} onclick={() => { item.flipY = !item.flipY; changed(); }} title="上下反転（ミラー）">⇅ 上下反転</button>
    </div>
    <button class="del" onclick={() => editor.deleteSelected()}>削除 (Del)</button>
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
  .sensor-search input { max-width: 150px; }
  .row { display: flex; gap: 4px; margin-top: 8px; }
  .row button { flex: 1; padding: 4px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .row button.on { background: #00d2c4; color: #042; border-color: #00d2c4; }
  .del { margin-top: 4px; padding: 4px; background: #5a2222; color: #fdd; border: 1px solid #7a3333; cursor: pointer; }
</style>
