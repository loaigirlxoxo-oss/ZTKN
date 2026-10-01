import { convertFileSrc } from "@tauri-apps/api/core";

// ローカル画像（絶対パス）を webview で読み込み、HTMLImageElement をキャッシュする。
// Konva は読み込み済み要素が要るので、未ロード時は loadImage().then(...) で後追い描画する。
const cache = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<HTMLImageElement>>();

export function getImage(path: string): HTMLImageElement | undefined {
  return cache.get(path);
}

export function loadImage(path: string): Promise<HTMLImageElement> {
  const cached = cache.get(path);
  if (cached) return Promise.resolve(cached);
  let p = loading.get(path);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { cache.set(path, img); loading.delete(path); resolve(img); };
      img.onerror = (e) => { loading.delete(path); reject(e); };
      img.src = convertFileSrc(path);
    });
    loading.set(path, p);
  }
  return p;
}

// 同梱の静的画像（/vu/... など）。convertFileSrc を通さずそのまま読む。
export function loadUrl(url: string): Promise<HTMLImageElement> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  let p = loading.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { cache.set(url, img); loading.delete(url); resolve(img); };
      img.onerror = (e) => { loading.delete(url); reject(e); };
      img.src = url;
    });
    loading.set(url, p);
  }
  return p;
}
