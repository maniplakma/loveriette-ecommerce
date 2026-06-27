"""
Remove image backgrounds (white, black, grey) from all deco PNGs.
Auto-detect + edge flood-fill + halo cleanup + red-web special case.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path
from PIL import Image

ASSETS = Path(__file__).resolve().parents[1] / 'assets'

PNG_FILES = [
    'deco-ball7.png',
    'deco-bow.png',
    'deco-dice.png',
    'deco-eyes.png',
    'deco-flowers.png',
    'deco-spiderman.png',
    'deco-spiral.png',
    'deco-web-corner.png',
    'deco-web.png',
]

TOLERANCE = 45


def lum(r: int, g: int, b: int) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def sat(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def color_dist(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def sample_corner_bg(px, w: int, h: int, size: int = 14) -> tuple[int, int, int]:
    regions: list[tuple[int, int, int]] = []
    corners = [(0, 0), (max(0, w - size), 0), (0, max(0, h - size)), (max(0, w - size), max(0, h - size))]
    for x0, y0 in corners:
        rs = [px[x, y][:] for y in range(y0, min(y0 + size, h)) for x in range(x0, min(x0 + size, w))]
        if not rs:
            continue
        avg = (
            sum(c[0] for c in rs) // len(rs),
            sum(c[1] for c in rs) // len(rs),
            sum(c[2] for c in rs) // len(rs),
        )
        regions.append(avg)
    if not regions:
        return (255, 255, 255)
    light = sum(1 for r in regions if lum(*r) > 140)
    if light >= len(regions) // 2 + 1:
        return (255, 255, 255)
    if light == 0:
        return (0, 0, 0)
    return (255, 255, 255) if light >= 2 else (0, 0, 0)


def matches_bg(r: int, g: int, b: int, bg: tuple[int, int, int], tol: int) -> bool:
    if color_dist((r, g, b), bg) <= tol:
        return True
    if lum(*bg) > 140 and lum(r, g, b) > 242 and sat(r, g, b) < 20:
        return True
    if lum(*bg) < 80 and lum(r, g, b) < 28 and sat(r, g, b) < 20:
        return True
    return False


def flood_remove(img: Image.Image, tol: int = TOLERANCE) -> Image.Image:
    img = img.convert('RGBA')
    px = img.load()
    w, h = img.size
    bg = sample_corner_bg(px, w, h)
    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_seed(x: int, y: int) -> None:
        if seen[y][x]:
            return
        r, g, b, _ = px[x, y]
        if matches_bg(r, g, b, bg, tol):
            seen[y][x] = True
            q.append((x, y))

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                nr, ng, nb, _ = px[nx, ny]
                if matches_bg(nr, ng, nb, bg, tol):
                    seen[ny][nx] = True
                    q.append((nx, ny))
    return img


def despill_halos(img: Image.Image, passes: int = 3) -> Image.Image:
    px = img.load()
    w, h = img.size
    for _ in range(passes):
        to_clear: list[tuple[int, int]] = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                l = lum(r, g, b)
                if sat(r, g, b) >= 28:
                    continue
                if l > 225 or l < 30:
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                            to_clear.append((x, y))
                            break
        for x, y in to_clear:
            px[x, y] = (px[x, y][0], px[x, y][1], px[x, y][2], 0)
    return img


def is_red_web_pixel(r: int, g: int, b: int) -> bool:
    return r > 70 and r > g + 20 and r > b + 20


def is_dark_stroke(r: int, g: int, b: int) -> bool:
    return lum(r, g, b) < 60 and sat(r, g, b) < 45


def clean_web_corner(img: Image.Image) -> Image.Image:
    """Spiderweb corner: strip all white/grey, keep red + black strokes only."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if is_red_web_pixel(r, g, b) or is_dark_stroke(r, g, b):
                continue
            if lum(r, g, b) > 120 or sat(r, g, b) < 30:
                px[x, y] = (r, g, b, 0)
    return img


def clean_dark_bg_image(img: Image.Image) -> Image.Image:
    """Full web on black: remove remaining near-black matte."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if is_red_web_pixel(r, g, b):
                continue
            if lum(r, g, b) < 35 and sat(r, g, b) < 30:
                px[x, y] = (r, g, b, 0)
    return img


def clean_light_bg_image(img: Image.Image) -> Image.Image:
    """Remove isolated light grey/white boxes not caught by flood."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if lum(r, g, b) > 200 and sat(r, g, b) < 40:
                px[x, y] = (r, g, b, 0)
    return img


def process(name: str) -> None:
    src = ASSETS / name
    if not src.exists():
        print(f'SKIP missing {name}')
        return
    out = ASSETS / name.replace('.png', '-cut.png')
    img = Image.open(src)
    img = flood_remove(img)
    img = despill_halos(img)

    if name == 'deco-web-corner.png':
        img = clean_web_corner(img)
    elif name == 'deco-web.png':
        img = clean_dark_bg_image(img)
    elif name in ('deco-spiral.png', 'deco-bow.png', 'deco-flowers.png'):
        img = clean_light_bg_image(img)

    img.save(out, 'PNG', optimize=True)
    px = img.load()
    w, h = img.size
    trans = sum(1 for y in range(h) for x in range(w) if px[x, y][3] == 0)
    corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    print(f'OK {out.name} transparent={100 * trans / (w * h):.1f}% corners={corners}')


def main() -> None:
    for name in PNG_FILES:
        process(name)


if __name__ == '__main__':
    main()
