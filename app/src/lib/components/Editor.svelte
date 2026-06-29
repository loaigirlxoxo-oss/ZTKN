<script lang="ts">
  import { onMount } from "svelte";
  import Palette from "./Palette.svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import Properties from "./Properties.svelte";
  import AssetLibrary from "./AssetLibrary.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { sensors } from "$lib/sensors/live.svelte";
  import { savePanel, loadPanel, listPanels } from "$lib/editor/persist";
  import { invoke } from "@tauri-apps/api/core";
  import { templates } from "$lib/templates";
  import { view } from "$lib/editor/view.svelte";
  import { monitorStore, loadMonitors, selectMonitor, monitorLabel } from "$lib/editor/monitors.svelte";
  import { autostartStore, loadAutostart, toggleAutostart } from "$lib/editor/autostart.svelte";

  let msg = $state("");
  let showAssets = $state(true);
  let wrapEl: HTMLDivElement | undefined = $state();
  let panelName = $state("default");        // 保存/読込に使う名前
  let savedList = $state<string[]>([]);      // 保存済みパネル一覧

  async function refreshSavedList(): Promise<void> {
    try { savedList = await listPanels(); } catch { /* 一覧取得失敗時は空のまま */ }
  }
  refreshSavedList();

  function loadTemplate(i: number): void {
    const t = templates[i];
    if (!t) return;
    editor.replacePanel(t.build());
    fitZoom();
    msg = `テンプレ「${t.name}」を読み込みました`;
  }

  // 表示倍率をビューポートに合わせる
  function fitZoom(): void {
    if (!wrapEl) return;
    const zw = (wrapEl.clientWidth - 32) / editor.panel.size.w;
    const zh = (wrapEl.clientHeight - 32) / editor.panel.size.h;
    editor.zoom = Math.max(0.1, Math.min(zw, zh));
  }

  loadMonitors(); // 接続中ディスプレイ一覧を取得（表示モニタ選択用）
  loadAutostart(); // OS自動起動の現在状態を取得

  // キーボードショートカット（フォーム入力中はネイティブに任せる）
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") { e.preventDefault(); editor.clearSelection(); return; } // 選択解除（密なレイアウトでも確実に消せる）
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "z") { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
      if (ctrl && k === "y") { e.preventDefault(); editor.redo(); return; }
      if (ctrl && k === "d") { e.preventDefault(); editor.duplicateSelected(); return; }
      if (ctrl && k === "c") { editor.copySelected(); return; }
      if (ctrl && k === "v") { editor.paste(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); editor.deleteSelected(); return; }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { e.preventDefault(); editor.nudge(-step, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); editor.nudge(step, 0); }
      else if (e.key === "ArrowUp") { e.preventDefault(); editor.nudge(0, -step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); editor.nudge(0, step); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function doSave(): Promise<void> {
    const name = panelName.trim();
    if (!name) { msg = "名前を入力してください"; return; }
    try {
      await savePanel(name, editor.panel);
      await refreshSavedList();
      msg = `「${name}」を保存しました`;
    } catch (e) {
      msg = "保存失敗: " + e; // 握りつぶさず表示
    }
  }

  async function doLoad(name: string): Promise<void> {
    if (!name) return;
    try {
      const p = await loadPanel(name);
      editor.replacePanel(p);
      panelName = name; // 次の保存先を読み込んだ名前にそろえる
      fitZoom();
      msg = `「${name}」を読み込みました`;
    } catch (e) {
      msg = "読込失敗: " + e; // 破損時も空で上書きしない
    }
  }
</script>

<div class="column">
  <div class="toolbar">
    <input class="pname" type="text" bind:value={panelName} placeholder="パネル名" title="保存名" />
    <button onclick={doSave} title="この名前で保存（既存なら上書き）">保存</button>
    <select class="ploadsel" title="保存済みパネルを読み込む" value="" onchange={(e) => { const v = e.currentTarget.value; if (v) doLoad(v); e.currentTarget.value = ""; }}>
      <option value="">読込…</option>
      {#each savedList as n}<option value={n}>{n}</option>{/each}
    </select>
    <button onclick={() => editor.undo()} disabled={!editor.canUndo} title="元に戻す (Ctrl+Z)">↶</button>
    <button onclick={() => editor.redo()} disabled={!editor.canRedo} title="やり直し (Ctrl+Y)">↷</button>
    <button onclick={() => (showAssets = !showAssets)}>アセット{showAssets ? "▼" : "▲"}</button>
    {#if monitorStore.list.length > 1}
      <select title="表示するモニタ" value={monitorStore.selected} onchange={(e) => selectMonitor(+e.currentTarget.value)}>
        {#each monitorStore.list as m, i}<option value={i}>{monitorLabel(m, i)}</option>{/each}
      </select>
    {/if}
    <button onclick={() => (view.present = true)} title="フルスクリーン表示（Escで戻る）">▶ 表示</button>
    <label class="auto" title="OSログイン時に自動起動（トレイ常駐で開始）">
      <input type="checkbox" checked={autostartStore.enabled} disabled={!autostartStore.ready}
        onchange={(e) => toggleAutostart(e.currentTarget.checked)} /> 自動起動
    </label>
    <select title="テンプレを選んで読み込む" onchange={(e) => { const v = e.currentTarget.value; if (v !== "") loadTemplate(+v); e.currentTarget.value = ""; }}>
      <option value="">テンプレ…</option>
      {#each templates as t, i}<option value={i}>{t.name}</option>{/each}
    </select>
    <span class="sep">|</span>
    <label class="size">レイアウト幅 <input type="number" min="100" bind:value={editor.panel.size.w} /></label>
    <label class="size">高さ <input type="number" min="100" bind:value={editor.panel.size.h} /></label>
    <span class="sep">|</span>
    <label class="size">表示
      <select bind:value={editor.zoom}>
        <option value={0.25}>25%</option>
        <option value={0.5}>50%</option>
        <option value={0.75}>75%</option>
        <option value={1}>100%</option>
        <option value={1.5}>150%</option>
        <option value={2}>200%</option>
      </select>
    </label>
    <button onclick={fitZoom}>フィット</button>
    <span class="sep">|</span>
    <span class="align" title="整列（2つ以上選択）/ 等間隔（3つ以上）">
      <button onclick={() => editor.align("left")} disabled={editor.selectedIds.length < 2} title="左揃え">⇤</button>
      <button onclick={() => editor.align("centerX")} disabled={editor.selectedIds.length < 2} title="左右中央">⇔</button>
      <button onclick={() => editor.align("right")} disabled={editor.selectedIds.length < 2} title="右揃え">⇥</button>
      <button onclick={() => editor.align("top")} disabled={editor.selectedIds.length < 2} title="上揃え">⤒</button>
      <button onclick={() => editor.align("centerY")} disabled={editor.selectedIds.length < 2} title="上下中央">↕</button>
      <button onclick={() => editor.align("bottom")} disabled={editor.selectedIds.length < 2} title="下揃え">⤓</button>
      <button onclick={() => editor.distribute("x")} disabled={editor.selectedIds.length < 3} title="横に等間隔">⋯</button>
      <button onclick={() => editor.distribute("y")} disabled={editor.selectedIds.length < 3} title="縦に等間隔">⋮</button>
    </span>
    <span class="sep">|</span>
    <span class="sensor-status">🌡 {sensors.status}</span>
    <button class="mini" title="センサーカタログを掃除（旧センサーを消して作り直す）" onclick={() => sensors.clearCatalog()}>🗑</button>
    <span class="msg">{msg}</span>
  </div>

  <div class="editor">
    <Palette />
    <div class="canvas-wrap" bind:this={wrapEl}><CanvasStage /></div>
    <Properties />
  </div>

  {#if showAssets}
    <div class="drawer"><AssetLibrary /></div>
  {/if}
</div>

<style>
  .column { display: flex; flex-direction: column; height: 100vh; }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: #111; border-bottom: 1px solid #222; flex: 0 0 auto; }
  .toolbar button { padding: 4px 12px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .sep { color: #444; }
  .size { color: #aaa; font-size: 12px; display: flex; align-items: center; gap: 4px; }
  .size input { width: 70px; background: #222; color: #ddd; border: 1px solid #3a3a3a; }
  .auto { color: #aaa; font-size: 12px; display: flex; align-items: center; gap: 3px; }
  .pname { width: 110px; background: #222; color: #ddd; border: 1px solid #3a3a3a; padding: 3px 6px; }
  .ploadsel { background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; }
  .align { display: flex; align-items: center; gap: 2px; }
  .align button { padding: 2px 7px; font-size: 13px; line-height: 1; }
  .sensor-status { color: #8ab; font-size: 12px; }
  .mini { padding: 2px 6px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .msg { color: #00ffcc; font-size: 12px; }
  .editor { display: flex; align-items: stretch; flex: 1 1 auto; min-height: 0; }
  .canvas-wrap { flex: 1; padding: 16px; overflow: auto; height: 100%; }
  .drawer { flex: 0 0 38vh; min-height: 0; }
</style>
