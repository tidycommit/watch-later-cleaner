"""Generate the extension icons (original art): a red rounded tile with a white clock and a sweeping check mark."""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'extension', 'icons')
os.makedirs(OUT, exist_ok=True)

def draw(size):
    S = 512  # draw large, downsample for anti-aliasing
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([16, 16, S - 16, S - 16], radius=110, fill=(204, 31, 31, 255))
    # clock face
    cx, cy, r = 230, 250, 150
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    d.ellipse([cx - r + 26, cy - r + 26, cx + r - 26, cy + r - 26], fill=(204, 31, 31, 255))
    # hands
    d.line([cx, cy, cx, cy - 80], fill=(255, 255, 255, 255), width=26)
    d.line([cx, cy, cx + 60, cy + 30], fill=(255, 255, 255, 255), width=26)
    d.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], fill=(255, 255, 255, 255))
    # check-mark badge
    bx, by, br = 370, 370, 98
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=(255, 255, 255, 255))
    d.line([(bx - 50, by + 2), (bx - 12, by + 42), (bx + 52, by - 40)], fill=(30, 150, 70, 255), width=34, joint='curve')
    return im.resize((size, size), Image.LANCZOS)

for s in (16, 48, 128):
    draw(s).save(os.path.join(OUT, f'icon{s}.png'))
print('ok')
