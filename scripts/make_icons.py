#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成扩展图标与商店 Logo。

    python scripts/make_icons.py

输出：
    edge-extension/icon{16,32,48,128}.png
    edge-extension/notification.png   （通知用 128px）
    store/logo-300.png                （Edge 加载项商店 Logo）

依赖：Pillow。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "edge-extension"
STORE = ROOT / "store"

S = 1024  # 先在 4 倍尺寸上绘制，再降采样，保证小尺寸边缘干净
TOP = (32, 122, 253)
BOTTOM = (7, 49, 116)
SHIELD = (255, 255, 255, 255)


def background() -> Image.Image:
    """圆角方块 + 纵向渐变。"""
    gradient = Image.new("RGB", (S, S))
    draw = ImageDraw.Draw(gradient)
    for y in range(S):
        t = y / (S - 1)
        draw.line(
            [(0, y), (S, y)],
            fill=tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)),
        )

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255
    )

    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.paste(gradient, (0, 0), mask)
    return canvas


def emblem() -> Image.Image:
    """护盾 + 对勾，代表“登录态受保护/正常”。"""
    canvas = background()
    draw = ImageDraw.Draw(canvas)

    draw.polygon(
        [(300, 232), (724, 232), (724, 606), (512, 850), (300, 606)],
        fill=SHIELD,
    )

    stroke = 66
    points = [(408, 500), (500, 600), (648, 410)]
    draw.line(points, fill=BOTTOM, width=stroke, joint="curve")
    for x, y in (points[0], points[-1]):
        draw.ellipse([x - stroke // 2, y - stroke // 2, x + stroke // 2, y + stroke // 2], fill=BOTTOM)
    return canvas


def main() -> None:
    art = emblem()
    EXT.mkdir(parents=True, exist_ok=True)
    STORE.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 48, 128):
        art.resize((size, size), Image.LANCZOS).save(EXT / f"icon{size}.png")
    art.resize((128, 128), Image.LANCZOS).save(EXT / "notification.png")
    art.resize((300, 300), Image.LANCZOS).save(STORE / "logo-300.png")

    print("图标已生成：", EXT, "与", STORE / "logo-300.png")


if __name__ == "__main__":
    main()
