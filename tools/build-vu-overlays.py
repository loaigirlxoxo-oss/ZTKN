"""VUメーターのガラスに重ねる「汚れ」「割れ」を、生成画像から透過PNGにして書き出す。

使い方:
    python tools/build-vu-overlays.py <名前> <生成画像.png>
    例: python tools/build-vu-overlays.py su-grime tmp-textures/v12-su-grime.png

- 生成画像は、無地の灰色の背景に汚れ（または割れ）だけが写ったもの。
  imagegen はアルファつきで出せないことが多いので、背景との差から透明度を作る。
- 背景より明るい画素は明るく、暗い画素は暗く乗る。色味（ヤニの黄ばみなど）は残る。
  背景色 b、画素 p、差 d = p - b のとき、透明度 a = max|d| / reach、色 c = b + d / a。
  こうすると「c を a で灰色の上に重ねる」と元の画素に戻る。別の背景に重ねれば汚れだけが乗る。
- 生成時にアルファつきで出ている画像（RGBA）は、そのまま使う。
- 窓は横長なので、中央の帯（3:1）を切り出す。
- 書き出し先: app/static/vu/overlays/<名前>.png
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), "..")
ASPECT = 3.0        # 窓の縦横比（国ごとに 2.9〜3.8。引き伸ばして使うので中間に寄せる）
MAX_W = 1280
REACH_PCT = 99.8    # 背景との差がこの百分位に当たる画素を不透明とみなす（灰色の上の汚れは差が小さい）
REACH_MIN = 36.0    # ただしこれより小さくはしない（ほぼ無地の画像でざらつきを持ち上げない）
FLOOR = 5.0         # これ以下の差は生成のざらつきとして捨てる（何も無い所を完全に透明にする）
BG_BLUR = 60        # 背景のゆるい明暗むら（周辺減光など）を追う半径


def center_band(im):
    w, h = im.size
    bh = min(h, round(w / ASPECT))
    top = (h - bh) // 2
    return im.crop((0, top, w, top + bh))


def background_color(im):
    """切り出す前の画像全体から、背景の灰色を測る。明るさの最頻値を背景とみなす。

    何も無い所は一様なので、明るさの分布に鋭い山ができる。汚れは値がばらつくので山にならない。
    - 中央値は使えない: 擦れが画面の半分を超えると擦れの色になる（v14-jp-scuff: 背景 123、中央値 138）
    - 四隅も使えない: 隅に汚れを溜めた素材がある（v12-su-grime）
    """
    a = np.asarray(im.convert("RGB")).astype(float)
    g = a.mean(axis=2)
    peak = np.bincount(g.round().astype(int).ravel(), minlength=256).argmax()
    return np.median(a[np.abs(g - peak) <= 2], axis=0)


def background(a, ref):
    """背景色を画素ごとに見積もる。背景色 ref に近い画素だけを集めて大きくぼかす。"""
    clean = (np.abs(a - ref).max(axis=2) < 6).astype(float)
    bg = np.empty_like(a)
    weight = ndimage.gaussian_filter(clean, BG_BLUR) + 1e-6
    for c in range(3):
        bg[:, :, c] = ndimage.gaussian_filter(a[:, :, c] * clean, BG_BLUR) / weight
    # 近くに背景が残っていない所（大きな汚れの中）は、背景色に戻す
    bg[weight < 0.05] = ref
    return bg, clean.mean()


def matte(im, ref):
    a = np.asarray(im.convert("RGB")).astype(float)
    bg, clean = background(a, ref)
    d = a - bg
    m = np.abs(d).max(axis=2)
    reach = min(127.0, max(REACH_MIN, float(np.percentile(m, REACH_PCT))))
    alpha = np.clip((m - FLOOR) / (reach - FLOOR), 0, 1)
    scale = np.where(m > 0, reach / np.maximum(m, 1e-6), 0)[:, :, None]
    color = np.clip(bg + d * scale, 0, 255)
    rgba = np.dstack([color, alpha * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA"), clean, reach


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    name, src = sys.argv[1:]
    out_dir = os.path.join(ROOT, "app", "static", "vu", "overlays")
    os.makedirs(out_dir, exist_ok=True)

    im = Image.open(src)
    print(f"[{name}] {src}  {im.size[0]}x{im.size[1]}  {im.mode}")
    has_alpha = im.mode == "RGBA" and np.asarray(im)[:, :, 3].min() < 250
    if has_alpha:
        out = center_band(im)
        print("  生成時のアルファをそのまま使う")
    else:
        med = background_color(im)
        out, clean, reach = matte(center_band(im), med)
        print(f"  背景 RGB={tuple(int(x) for x in med)}  背景とみなした画素 {clean * 100:.0f}%  reach {reach:.0f}")
    if out.size[0] > MAX_W:
        out = out.resize((MAX_W, round(out.size[1] * MAX_W / out.size[0])), Image.LANCZOS)
    al = np.asarray(out)[:, :, 3].astype(float) / 255
    rgb = np.asarray(out)[:, :, :3].astype(float).mean(axis=2)
    lit = (al * (rgb >= 128)).sum()
    dark = (al * (rgb < 128)).sum()
    print(f"  {out.size[0]}x{out.size[1]}  透明 {np.mean(al < 0.02) * 100:.0f}%  "
          f"平均の濃さ {al.mean() * 100:.1f}%  明:暗 = {lit / max(lit + dark, 1e-6) * 100:.0f}:{dark / max(lit + dark, 1e-6) * 100:.0f}")
    path = os.path.join(out_dir, f"{name}.png")
    out.save(path, optimize=True)
    print(f"  書き出し: {path}  {os.path.getsize(path) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
