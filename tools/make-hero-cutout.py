#!/usr/bin/env python3
"""
Derive the hero's floating-garment depth layers from a photo already in the repo.

Input : assets/images/product-olive-crew.jpg   (garment on a flat studio backdrop)
Output: assets/images/hero-garment.{webp,png}         layer 3 - alpha-matted garment
        assets/images/hero-garment-shadow.{webp,png}  layer 2 - its own contact shadow

No new photography is introduced. The hero previously used a flattened webpage
mock-up as its "product"; separating this studio shot into a matted garment plus a
free-standing shadow is what lets the parallax move them at different depths.

Run:  python3 tools/make-hero-cutout.py
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = "assets/images/product-olive-crew.jpg"
OUT = "assets/images/hero-garment"
SHADOW = "assets/images/hero-garment-shadow"

T_LOW, T_HIGH = 30.0, 72.0   # RGB distance from the backdrop plate: matte ramp


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def backdrop_plate(img):
    """Estimate the studio backdrop as a smooth field.

    The garment is darker than the seamless behind it, so a max-filter at low
    resolution reconstructs the backdrop (including its vignette and the light
    falloff) without any of the garment leaking in."""
    small = img.resize((img.width // 12, img.height // 12), Image.BOX)
    plate = small.filter(ImageFilter.MaxFilter(29)).filter(ImageFilter.GaussianBlur(7))
    return np.asarray(plate.resize(img.size, Image.BICUBIC)).astype(np.float32)


def main():
    img = Image.open(SRC).convert("RGB")
    rgb = np.asarray(img).astype(np.float32)
    h, w, _ = rgb.shape
    plate = backdrop_plate(img)

    dist = np.sqrt(((rgb - plate) ** 2).sum(axis=2))
    alpha = smoothstep(dist, T_LOW, T_HIGH)

    # Keep only the connected garment: flood its solid core from its own
    # centroid, so the cast shadow (a separate blob on the floor) and any
    # backdrop grain outside it can never leak into this layer.
    core = ((alpha > 0.5).astype(np.uint8) * 255)
    cy, cx = np.argwhere(alpha > 0.8).mean(axis=0).astype(int)
    core_img = Image.fromarray(core, "L").copy()
    ImageDraw.floodfill(core_img, (int(cx), int(cy)), 128, thresh=40)
    gate = Image.fromarray(((np.asarray(core_img) == 128).astype(np.uint8) * 255), "L")
    gate = gate.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.6))
    gate_a = np.asarray(gate).astype(np.float32) / 255.0
    alpha = alpha * gate_a

    a_img = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.8))
    alpha = np.asarray(a_img).astype(np.float32) / 255.0

    # Layer 2 - contact shadow, built from the garment's own silhouette rather
    # than lifted from the photo: the studio plate's vignette is noise, while a
    # squashed, heavily blurred copy of the real outline reads as a grounded
    # shadow and can be moved/scaled independently by the parallax.
    ys, xs = np.where(alpha > 0.08)
    pad = 20
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 70)

    cut = Image.merge("RGBA", (*img.split(), Image.fromarray((alpha * 255).astype(np.uint8), "L")))
    cut = cut.crop((x0, y0, x1, y1))
    cw, ch = cut.size
    cut.save(OUT + ".png", optimize=True)
    cut.save(OUT + ".webp", quality=90, method=6)

    sil = cut.split()[3]
    # Squashed into a floor ellipse on a canvas the same size as the garment,
    # so both layers share one origin and the CSS can offset the shadow with a
    # single translate. Kept clear of the bottom edge: a clipped blur would
    # read as a hard band rather than as a shadow.
    squash = sil.resize((int(cw * 0.80), max(8, int(ch * 0.11))), Image.BILINEAR)
    plate_sh = Image.new("L", (cw, ch), 0)
    plate_sh.paste(squash, (int(cw * 0.10), int(ch * 0.83)))
    plate_sh = plate_sh.filter(ImageFilter.GaussianBlur(ch * 0.05))
    plate_sh = plate_sh.point(lambda v: int(min(255, v * 0.8)))
    ink = Image.new("RGBA", (cw, ch), (20, 42, 38, 0))
    ink.putalpha(plate_sh)
    ink.save(SHADOW + ".png", optimize=True)
    ink.save(SHADOW + ".webp", quality=82, method=6)

    # Contact sheet so the matte can be eyeballed against the site background.
    proof = Image.new("RGB", cut.size, (247, 245, 239))
    proof.paste(cut, (0, 0), cut)
    proof.save("/tmp/claude-0/-home-user-Knitic-cloting/2c70321b-7414-50ad-961e-12a6d40aecc6/scratchpad/matte-proof.jpg", quality=90)
    print("garment", cut.size, "from bbox", (x0, y0, x1, y1))


if __name__ == "__main__":
    main()
