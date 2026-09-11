# Brand kit provenance

## favicon-*-light.png — derived, not drawn

The Latch mark is a white hook plus a blue crescent on transparency. That reads
whole on dark browser chrome and loses half of itself on light chrome, where the
white hook disappears and only the crescent survives.

The `-light` variants are the SAME asset with the near-white pixels remapped to
`--ink` (#12151A). Nothing was redrawn and the blue is untouched — this is a
recolour of our own mark, not an approximation of it, so it does not fall under
the "never draw an approximation of somebody's logo" rule that governs
third-party marks in this file.

Regenerate from the originals if the mark changes:

```python
from PIL import Image
INK = (18, 21, 26)

def to_light(src, dst):
    im = Image.open(src).convert('RGBA'); px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            # Bright and near-neutral = the white hook. The blue crescent has a
            # wide channel spread (b >> r) so it never matches.
            if mx >= 150 and (mx - mn) <= 40:
                t = min(max((mx - 150) / 105.0, 0.0), 1.0)
                k = 0.35 + 0.65 * t          # keep antialiased edges smooth
                px[x, y] = (int(r + (INK[0]-r)*k), int(g + (INK[1]-g)*k),
                            int(b + (INK[2]-b)*k), a)
    im.save(dst)

for s in (16, 32, 64, 180, 512):
    to_light(f'favicon-{s}.png', f'favicon-{s}-light.png')
```

## Broken: favicon.svg, latch-mark.svg, latch-wordmark.svg

All three are a 512x512 `<image>` element with **no href attribute** and ~7.7KB
of C2PA metadata. They render nothing. `favicon.svg` was referenced first in
index.html as `type="image/svg+xml"`, so any browser preferring SVG got a blank
tab icon; that reference is removed. None of the three may be used until they
are re-exported with real vector content.
