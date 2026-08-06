#!/usr/bin/env python3
"""Split the player watermarks into reusable player and ball layers.

Inputs live in `assets/player-source/` and are NOT shipped in the extension:
the full-size watermark PNGs are ~800 KB combined and only the derived layers
are loaded at runtime.

Outputs:
  public/player-animation/{player}-{player,ball}.webp  -> shipped, used at runtime
  assets/player-source/assets.json                     -> build metadata only

The spin strip the earlier revision produced is no longer emitted: the kick
effect rotates the single ball sprite on the GPU, so the 8-frame strip was
~510 KB of dead weight in the package.
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SOURCE_DIR = ROOT / "assets" / "player-source"
OUTPUT = PUBLIC / "player-animation"

# Quality 94 with lossless alpha measured at 0.998 alpha-aware SSIM against the
# PNG originals while cutting ~75% of the bytes.
WEBP_QUALITY = 94

PLAYERS = {
    "messi": SOURCE_DIR / "messi-watermark.png",
    "mbappe": SOURCE_DIR / "mbappe-watermark.png",
}

EXTRA_PLAYER_ERASE_BOXES = {
    "mbappe": [(325, 820, 410, 900)],
}

ALPHA_COMPONENT_MIN_PIXELS = 10
BALL_FRAME_SIZE = 160


def alpha_components(image: Image.Image) -> list[dict[str, object]]:
    alpha = image.getchannel("A")
    pixels = alpha.load()
    width, height = image.size
    seen = bytearray(width * height)
    components: list[dict[str, object]] = []

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if seen[index] or pixels[x, y] == 0:
                continue

            seen[index] = 1
            queue = deque([(x, y)])
            points: list[tuple[int, int]] = []
            min_x = max_x = x
            min_y = max_y = y

            while queue:
                current_x, current_y = queue.pop()
                points.append((current_x, current_y))
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)

                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_index = next_y * width + next_x
                    if seen[next_index] or pixels[next_x, next_y] == 0:
                        continue
                    seen[next_index] = 1
                    queue.append((next_x, next_y))

            if len(points) >= ALPHA_COMPONENT_MIN_PIXELS:
                components.append(
                    {
                        "points": points,
                        "area": len(points),
                        "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                    }
                )

    components.sort(key=lambda component: int(component["area"]), reverse=True)
    return components


def render_component(source: Image.Image, points: list[tuple[int, int]]) -> Image.Image:
    layer = Image.new("RGBA", source.size, (0, 0, 0, 0))
    source_pixels = source.load()
    layer_pixels = layer.load()
    for x, y in points:
        layer_pixels[x, y] = source_pixels[x, y]
    return layer


def isolate_round_ball(image: Image.Image) -> Image.Image:
    bbox = image.getbbox()
    if bbox is None:
        raise ValueError("Cannot isolate an empty ball")
    left, top, right, bottom = bbox
    diameter = min(right - left, bottom - top)
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    circle_bbox = (
        round(center_x - diameter / 2),
        round(center_y - diameter / 2),
        round(center_x + diameter / 2),
        round(center_y + diameter / 2),
    )

    scale = 4
    mask = Image.new("L", (image.width * scale, image.height * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse(tuple(value * scale for value in circle_bbox), fill=255)
    mask = mask.resize(image.size, Image.Resampling.LANCZOS)

    isolated = image.copy()
    isolated.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return isolated


def fit_on_square(image: Image.Image, size: int) -> Image.Image:
    bbox = image.getbbox()
    if bbox is None:
        raise ValueError("Cannot fit an empty image")
    cropped = image.crop(bbox)
    usable = size - 20
    scale = min(usable / cropped.width, usable / cropped.height)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    square = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    square.alpha_composite(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
    )
    return square


def split_player(player_id: str, source_path: Path) -> dict[str, object]:
    source = Image.open(source_path).convert("RGBA")
    components = alpha_components(source)
    if len(components) < 2:
        raise RuntimeError(f"Expected separate player and ball components in {source_path}")

    player_component = components[0]
    ball_component = components[1]
    player_points = set(player_component["points"])
    ball_points = ball_component["points"]
    ball_bbox = ball_component["bbox"]

    # Preserve every original pixel except the detached ball and tiny kick debris
    # around it. This retains antialiased details that may form tiny components.
    player_layer = source.copy()
    player_pixels = player_layer.load()
    left, top, right, bottom = ball_bbox
    debris_margin = 60
    erase_left = max(0, left - debris_margin)
    erase_top = max(0, top - debris_margin)
    erase_right = min(source.width, right + debris_margin)
    erase_bottom = min(source.height, bottom + debris_margin)
    for y in range(erase_top, erase_bottom):
        for x in range(erase_left, erase_right):
            if (x, y) not in player_points:
                player_pixels[x, y] = (0, 0, 0, 0)

    for box in EXTRA_PLAYER_ERASE_BOXES.get(player_id, []):
        box_left, box_top, box_right, box_bottom = box
        for y in range(box_top, box_bottom):
            for x in range(box_left, box_right):
                player_pixels[x, y] = (0, 0, 0, 0)

    ball_layer = isolate_round_ball(render_component(source, ball_points))
    ball_square = fit_on_square(ball_layer, BALL_FRAME_SIZE)
    ball_center = {
        "x": round((left + right) / 2, 2),
        "y": round((top + bottom) / 2, 2),
    }

    player_path = OUTPUT / f"{player_id}-player.webp"
    ball_path = OUTPUT / f"{player_id}-ball.webp"
    player_layer.save(player_path, quality=WEBP_QUALITY, alpha_quality=100, method=6)
    ball_square.save(ball_path, quality=WEBP_QUALITY, alpha_quality=100, method=6)

    return {
        "source": f"assets/player-source/{source_path.name}",
        "player": f"/player-animation/{player_path.name}",
        "ball": f"/player-animation/{ball_path.name}",
        "canvas": {"width": source.width, "height": source.height},
        "ballSourceBox": {
            "x": left,
            "y": top,
            "width": right - left,
            "height": bottom - top,
        },
        "ballCenter": ball_center,
        "ballCenterNormalized": {
            "x": round(ball_center["x"] / source.width, 6),
            "y": round(ball_center["y"] / source.height, 6),
        },
    }


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 2,
        "players": {
            player_id: split_player(player_id, source_path)
            for player_id, source_path in PLAYERS.items()
        },
    }
    (SOURCE_DIR / "assets.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
