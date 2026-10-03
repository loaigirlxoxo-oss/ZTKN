"""VUメーターの素材（枠・紙・ガラス）をアプリ用に書き出し、窓と目盛の幾何を出す。

使い方:
    python tools/build-vu-assets.py <id> <枠.png> <紙.png> <ガラス.png> [--frame 横,縦] [--numerals-outside]
    例: python tools/build-vu-assets.py us tmp-textures/v11-us-bezel-new.png ...

    --frame 横,縦        窓を枠の開口より広げ、枠の見え幅を左右=横 px、上下=縦 px にする。
                         開口が小さく枠が太すぎる素材で、文字板を大きく見せるために使う。
                         ネジに掛からない値は見て決める（開口まわりの額縁は文字板に隠れる）。
    --numerals-outside   数字を弧の外側に置く文字板（アメリカ製・日本製）。数字が窓の上端で
                         切れないよう、半径を (支点〜窓の上端 − 4px) / 1.125 までに抑える。

- 各画像の「純黒の余白の内側にある絵」を切り出す（上下も左右も）（imagegen の出力は帯の位置が毎回ずれるので測る）
- 枠の開口（いちばん大きい純黒の塊）を窓とする
- 紙とガラスは窓に引き伸ばして使うので、表示に足りる大きさまで縮めて書き出す
- 書き出し先: app/static/vu/<id>/{bezel,paper,glass}.png
- 最後に vumeter.ts の VU_VARIANTS に書く数値を出す

目盛の幾何は、文字板1枚（窓の左右半分）の幅の 85% を弧の横幅にし、開き角は ±49 度。
支点は窓の下端から 27px 上。弧の頂点が窓の上端から 42px より近くなるなら半径を詰める。
"""
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), "..")
BLACK = 12          # RGB の合計がこれ以下を純黒とみなす
ARC_SPAN_DEG = 49
ARC_WIDTH_RATIO = 0.85
PIVOT_FROM_BOTTOM = 27
APEX_MIN_FROM_TOP = 42
NUMERAL_REACH = 1.125     # 外側の数字の上端は支点から 半径 x これ（vumeter.ts の us / jp の描き方）
NUMERAL_CLEARANCE = 4
PAPER_MAX_W = 1280  # 紙は窓に引き伸ばすので、これ以上の解像度は要らない
GLASS_MAX_W = 1024


def band(path):
    """純黒でない行と列の範囲で切り出す。

    左右も切る。imagegen のガラスは左右に純黒の余白が付くことがあり（実測で幅の 2〜8%）、
    残したまま窓に引き伸ばすと、映り込みが文字板より小さく見える。
    """
    im = Image.open(path).convert("RGB")
    s = np.asarray(im).astype(int).sum(axis=2)
    rows = np.where(s.max(axis=1) > BLACK)[0]
    if len(rows) == 0:
        raise SystemExit(f"{path}: 絵が無い（全面が純黒）")
    cols = np.where(s[rows[0]:rows[-1] + 1].max(axis=0) > BLACK)[0]
    return im.crop((cols[0], rows[0], cols[-1] + 1, rows[-1] + 1)), (int(rows[0]), int(rows[-1]))


def clear_outside(bezel):
    """枠の外側（画像の外周とつながる純黒）を透明にし、絵のある範囲で切り詰める。

    imagegen の枠はキャンバスいっぱいに広がらず、左右や角の丸みの外に純黒が残る。
    窓の黒は枠に囲まれていて外周とつながらないので、透明にならない。
    黒いベークライトの枠そのものを透かさないよう、対象は純黒に限り、境目の 1px だけ滑らかにする。
    """
    a = np.asarray(bezel.convert("RGB")).astype(int)
    s = a.sum(axis=2)
    lab, _ = ndimage.label(s <= BLACK)
    edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(edge_labels))
    alpha = np.full(s.shape, 255, np.uint8)
    alpha[outside] = 0
    ring = ndimage.binary_dilation(outside) & ~outside      # 外側に接する 1px
    soft = ring & (s <= 45)
    alpha[soft] = np.clip(s[soft] * 255 // 45, 0, 255).astype(np.uint8)
    rgba = np.dstack([a.astype(np.uint8), alpha])
    ys, xs = np.where(alpha > 0)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    return Image.fromarray(rgba, "RGBA").crop((x0, y0, x1, y1)), outside.mean()


def window_of(bezel):
    """枠の開口 = いちばん大きい純黒の塊の外接矩形。"""
    a = np.asarray(bezel.convert("RGBA")).astype(int)
    dark = (a[:, :, :3].sum(axis=2) <= BLACK) & (a[:, :, 3] > 0)   # 透明にした外側は窓ではない
    lab, n = ndimage.label(dark)
    if n == 0:
        raise SystemExit("枠に開口（純黒の領域）が無い")
    sizes = ndimage.sum(dark, lab, range(1, n + 1))
    ys, xs = np.where(lab == int(np.argmax(sizes)) + 1)
    return dict(left=int(xs.min()), top=int(ys.min()),
                width=int(xs.max() - xs.min() + 1), height=int(ys.max() - ys.min() + 1))


def geometry(win, numerals_outside):
    dial_w = win["width"] / 2
    r = ARC_WIDTH_RATIO * dial_w / (2 * math.sin(math.radians(ARC_SPAN_DEG)))
    pivot_y = win["top"] + win["height"] - PIVOT_FROM_BOTTOM
    r = min(r, pivot_y - win["top"] - APEX_MIN_FROM_TOP)
    if numerals_outside:
        r = min(r, (pivot_y - win["top"] - NUMERAL_CLEARANCE) / NUMERAL_REACH)
    return round(pivot_y, 1), round(r, 1)


def fit(im, max_w):
    if im.size[0] <= max_w:
        return im
    return im.resize((max_w, round(im.size[1] * max_w / im.size[0])), Image.LANCZOS)


def colors(im):
    a = np.asarray(im.convert("RGB"))
    return len(np.unique(a.reshape(-1, 3), axis=0))


def main():
    args = sys.argv[1:]
    numerals_outside = "--numerals-outside" in args
    frame_px = None
    if "--frame" in args:
        frame_px = tuple(int(n) for n in args[args.index("--frame") + 1].split(","))
        del args[args.index("--frame"):args.index("--frame") + 2]
    args = [a for a in args if a != "--numerals-outside"]
    if len(args) != 4 or (frame_px and len(frame_px) != 2):
        raise SystemExit(__doc__)
    vid, bezel_p, paper_p, glass_p = args
    out = os.path.join(ROOT, "app", "static", "vu", vid)
    os.makedirs(out, exist_ok=True)

    bezel, by = band(bezel_p)
    bezel, outside = clear_outside(bezel)
    paper, py = band(paper_p)
    glass, gy = band(glass_p)
    win = window_of(bezel)
    W, H = bezel.size
    if frame_px:
        print(f"  開口: left={win['left']} top={win['top']} width={win['width']} height={win['height']}（--frame で広げる）")
        win = dict(left=frame_px[0], top=frame_px[1], width=W - 2 * frame_px[0], height=H - 2 * frame_px[1])
    frame = (win["left"], win["top"], W - win["left"] - win["width"], H - win["top"] - win["height"])

    print(f"[{vid}]")
    for name, im, rng in (("枠", bezel, by), ("紙", paper, py), ("ガラス", glass, gy)):
        print(f"  {name}: 帯 y={rng[0]}..{rng[1]}  {im.size[0]}x{im.size[1]}  固有色 {colors(im):,}")
    print(f"  枠の外側を透明に: {outside * 100:.1f}%")
    print(f"  窓: left={win['left']} top={win['top']} width={win['width']} height={win['height']}")
    print(f"  枠の見え幅: 左{frame[0]} 上{frame[1]} 右{frame[2]} 下{frame[3]}")
    if min(frame) < 20:
        print("  ⚠ 枠が細すぎる辺がある（20px 未満）。ネジが窓に食い込んでいないか見て確かめる")

    pivot_y, r = geometry(win, numerals_outside)
    print(f"  支点 y={pivot_y}  半径 {r}  弧の頂点は窓の上端から {pivot_y - r - win['top']:.1f}px")

    bezel.save(os.path.join(out, "bezel.png"), optimize=True)
    fit(paper, PAPER_MAX_W).save(os.path.join(out, "paper.png"), optimize=True)
    fit(glass, GLASS_MAX_W).save(os.path.join(out, "glass.png"), optimize=True)
    total = sum(os.path.getsize(os.path.join(out, f)) for f in ("bezel.png", "paper.png", "glass.png"))
    print(f"  書き出し: {out}  計 {total / 1048576:.2f} MB")
    print(f"""  ---- vumeter.ts 用 ----
    panel: [{W}, {H}],
    window: {{ left: {win['left']}, top: {win['top']}, width: {win['width']}, height: {win['height']} }},
    pivotY: {pivot_y},
    radius: {r},
    src: {{ bezel: "/vu/{vid}/bezel.png", paper: "/vu/{vid}/paper.png", glass: "/vu/{vid}/glass.png" }},""")


if __name__ == "__main__":
    main()
