"""Draws TrustGraph's icons and the Web Store promo tile. Dev-only.

    pip install pillow
    python3 trustgraph_extension/scripts/make_icons.py

Writes:
    trustgraph_extension/icons/icon-16.png, -32, -48, -128   (toolbar / extensions page)
    trustgraph_extension/store/assets/promo-440x280.png       (Web Store small promo tile)

The artwork is a shield with a check mark, matching icons/icon.svg and
the shield button on the page. Shapes are drawn at 8x and scaled down for
smooth edges.
"""

from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    raise SystemExit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
NAVY = (0x1E, 0x27, 0x61, 255)
ICE = (0xCA, 0xDC, 0xFC, 255)
CORAL = (0xE6, 0x39, 0x46, 255)
WHITE = (255, 255, 255, 255)
SCALE = 8


def cubic(p0, p1, p2, p3, steps=40):
    """Points along a cubic Bezier curve."""
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


# Same outline as the SVG path "M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z"
# in a 24x24 box.
SHIELD = (
    [(12, 2), (4, 5), (4, 11)]
    + cubic((4, 11), (4, 16), (7.4, 20.3), (12, 22))
    + cubic((12, 22), (16.6, 20.3), (20, 16), (20, 11))
    + [(20, 5)]
)
CHECK = [(8.5, 12.2), (10.9, 14.6), (15.7, 9.6)]


def draw_shield(draw, x, y, size, check_width, ring=0):
    """Shield + check scaled from the 24-unit box into a size x size square."""
    k = size / 24
    outline = [(x + px * k, y + py * k) for px, py in SHIELD]
    if ring:
        # A light rim keeps the navy shield visible on dark toolbars.
        draw.polygon(outline, fill=NAVY, outline=ICE, width=max(1, round(ring * k)))
    else:
        draw.polygon(outline, fill=NAVY)
    pts = [(x + px * k, y + py * k) for px, py in CHECK]
    w = max(1, round(check_width * k))
    draw.line(pts, fill=ICE, width=w, joint="curve")
    r = w / 2  # round caps
    for px, py in (pts[0], pts[-1]):
        draw.ellipse((px - r, py - r, px + r, py + r), fill=ICE)


def make_icon(size):
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Chrome's guideline: 128px icons keep ~16px of padding around the art.
    pad = big * (0.125 if size >= 48 else 0.0)
    art = big - 2 * pad
    # Small icons need a bolder check to stay readable.
    check = 3.2 if size <= 16 else 2.8 if size <= 32 else 2.4
    draw_shield(draw, pad, pad, art, check, ring=1.0 if size <= 16 else 0.8)
    return img.resize((size, size), Image.LANCZOS)


def font(size, bold=False):
    names = ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"] if bold else ["DejaVuSans.ttf", "LiberationSans-Regular.ttf"]
    for folder in ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation", "/Library/Fonts", "C:/Windows/Fonts"]:
        for name in names:
            path = Path(folder) / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def make_promo():
    w, h = 440 * SCALE // 2, 280 * SCALE // 2  # 4x, then scale down
    k = w / 440
    img = Image.new("RGBA", (w, h), NAVY)
    draw = ImageDraw.Draw(img)

    # Faint "graph" motif in the background: nodes joined by lines.
    nodes = [(395, 28), (428, 82), (398, 142), (426, 200), (384, 252), (322, 238)]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 2), (0, 2)]
    faint = (0xCA, 0xDC, 0xFC, 60)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for a, b in edges:
        od.line([(nodes[a][0] * k, nodes[a][1] * k), (nodes[b][0] * k, nodes[b][1] * k)], fill=faint, width=round(2 * k))
    for i, (nx, ny) in enumerate(nodes):
        r = (7 if i != 2 else 9) * k
        od.ellipse((nx * k - r, ny * k - r, nx * k + r, ny * k + r), fill=CORAL if i == 2 else faint)
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    # White rounded tile with the shield, then the name and tagline.
    tile = (32 * k, 70 * k, 132 * k, 170 * k)
    draw.rounded_rectangle(tile, radius=22 * k, fill=WHITE)
    draw_shield(draw, 42 * k, 80 * k, 80 * k, 2.4)

    draw.text((150 * k, 82 * k), "TrustGraph", font=font(round(34 * k), bold=True), fill=WHITE)
    draw.text((152 * k, 132 * k), "Check a message for", font=font(round(17 * k)), fill=ICE)
    draw.text((152 * k, 154 * k), "scam signals.", font=font(round(17 * k)), fill=ICE)
    return img.resize((440, 280), Image.LANCZOS).convert("RGB")


def main():
    icons = ROOT / "icons"
    icons.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        make_icon(size).save(icons / f"icon-{size}.png")
        print(f"wrote icons/icon-{size}.png")
    assets = ROOT / "store" / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    make_promo().save(assets / "promo-440x280.png")
    print("wrote store/assets/promo-440x280.png")


if __name__ == "__main__":
    main()
