"""Build small game textures; originals in assets/stickers are never overwritten.
Developer-only: requires Pillow. Run python scripts/optimize_merge_images.py,
then python scripts/package_merge.py. Playing and regular packaging need no Pillow.
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MAX_SIDE = 960
MAX_SIDE_BY_NAME = {"form1": 1400}  # Preserve this tier's thin alpha contour.
WEBP_QUALITY = 85
ALPHA_THRESHOLD = 16

if __name__ == '__main__':
    config = json.loads((ROOT / 'config/merge/default.json').read_text(encoding='utf-8'))
    output = ROOT / 'assets/game'
    output.mkdir(exist_ok=True)
    for item in config['items']:
        stem = Path(item['image']).stem
        source = ROOT / 'assets/stickers' / (stem + '.png')
        with Image.open(source) as original:
            image = original.convert('RGBA')
            bounds = image.getchannel('A').point(lambda a: 255 if a >= ALPHA_THRESHOLD else 0).getbbox()
            if bounds is None:
                raise ValueError(f'Empty image: {source}')
            image = image.crop(bounds)
            limit = MAX_SIDE_BY_NAME.get(stem, MAX_SIDE)
            image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
            target = output / (stem + '.webp')
            image.save(target, format='WEBP', quality=WEBP_QUALITY, method=6)
            print(f'{target.name}: {image.width}x{image.height}, {target.stat().st_size} bytes')
