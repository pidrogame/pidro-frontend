"""Make a sharper, larger card from the 168x233 art, without changing how it looks.

A glyph is ink over a smooth background. The card is upscaled smoothly, the
background under the ink is estimated, and each pixel's share of ink (0..1) is
measured. Only the thin zone around a glyph's outline is made steeper. Gloss and
gradients inside a glyph, the card's background and its own edge and shadow keep
their upscaled colours, so nothing rings and nothing gets a rim.

The work is done at WORK times the source size and reduced to OUT times, so the
new edges are properly anti-aliased.

usage: cards-sharpen.py <in.png> <out.png> [out_scale=2] [work_scale=4]

The 336x466 set in assets/images/cards-2x (PID-467), regenerated from
packages/mobile, then losslessly optimised (no palette reduction):

  for f in assets/images/cards/*.png; do o=assets/images/cards-2x/${f##*/}; uv run -q --with pillow --with numpy --with scipy python scripts/cards-sharpen.py "$f" "$o" && uv run -q --with pyoxipng python -c "import oxipng, sys; oxipng.optimize(sys.argv[1], level=6, strip=oxipng.StripChunks.safe())" "$o"; done
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, dst = sys.argv[1], sys.argv[2]
OUT = int(sys.argv[3]) if len(sys.argv) > 3 else 2
WORK = int(sys.argv[4]) if len(sys.argv) > 4 else 4

im = Image.open(src).convert("RGBA")
w, h = im.size
up = im.resize((w * WORK, h * WORK), Image.BICUBIC)
a = np.asarray(up).astype(np.float32) / 255.0
rgb, alpha = a[..., :3], a[..., 3]
s = WORK

lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
sat = rgb.max(-1) - rgb.min(-1)

# Background samples: opaque, light, grey, and away from any glyph edge.
is_bg = (alpha > 0.98) & (lum > 0.80) & (sat < 0.06)
is_bg = ndi.binary_erosion(is_bg, iterations=2 * s)

# The background under the ink: a normalised blur of the samples, widening until
# every pixel has an estimate (the big suit is about 70 px wide at 1x).
bg = np.zeros_like(rgb)
have = np.zeros(lum.shape, dtype=bool)
for sigma in (3 * s, 8 * s, 20 * s, 45 * s):
    wgt = ndi.gaussian_filter(is_bg.astype(np.float32), sigma)
    est = np.stack([ndi.gaussian_filter(rgb[..., c] * is_bg, sigma) for c in range(3)], -1)
    ok = (wgt > 0.05) & ~have
    bg[ok] = est[ok] / wgt[ok][:, None]
    have |= ok
bg[is_bg] = rgb[is_bg]
bg[~have] = rgb[~have]

# Ink share: how far a pixel is from its background, against the ink right beside it.
dev = np.linalg.norm(rgb - bg, axis=-1)
full = ndi.maximum_filter(dev, size=3 * s + 1)
full = ndi.gaussian_filter(full, 0.75 * s)
ink = np.where(full > 0.12, np.clip(dev / np.maximum(full, 1e-4), 0, 1), 0.0)


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


# Steeper only in the zone around an outline, and only on the opaque card.
outside = ink < 0.15
zone = ndi.binary_dilation(outside, iterations=2 * s) & ~ndi.binary_erosion(outside, iterations=2 * s)
zone &= alpha > 0.98
new_ink = smooth((ink - 0.36) / 0.28)
gain = np.ones_like(ink)
ok = zone & (ink > 0.02)
gain[ok] = new_ink[ok] / ink[ok]
# Never darker than the ink beside it: no rims.
gain = np.minimum(gain, np.where(dev > 1e-4, full / np.maximum(dev, 1e-4), 1.0))
out = np.clip(bg + (rgb - bg) * gain[..., None], 0, 1)

res = Image.fromarray((np.dstack([out, alpha]) * 255 + 0.5).astype(np.uint8))
if OUT != WORK:
    res = res.resize((w * OUT, h * OUT), Image.LANCZOS)
res.save(dst, optimize=True)
