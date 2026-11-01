#!/usr/bin/env python3
"""Draw a clean scoreboard fixture so OCR and the sample button share one roster."""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ROSTER = json.loads((ROOT / "fixtures" / "roster.json").read_text())
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    raise SystemExit("Install DejaVu or Liberation fonts to draw the sample scoreboard.")


def main() -> None:
    names: list[str] = ROSTER["names"]
    noise: list[str] = [word for word in ROSTER["noise"] if word != "SCOREBOARD"]
    title_font = font(34)
    name_font = font(58)
    row_h = 86
    height = 130 + row_h * (len(names) + len(noise)) + 40
    image = Image.new("RGB", (1500, height), "#12160f")
    draw = ImageDraw.Draw(image)
    draw.text((48, 36), "SCOREBOARD", font=title_font, fill="#e46a2f")

    y = 110
    for index, name in enumerate(names):
        draw.rectangle((36, y, 1464, y + row_h - 12), fill="#232a1e" if index % 2 == 0 else "#1a2018")
        draw.text((72, y + 6), name, font=name_font, fill="#f7f4ec")
        y += row_h
    for word in noise:
        draw.text((60, y + 8), word, font=name_font, fill="#d9dece")
        y += row_h

    destination = ROOT / "fixtures" / "scoreboard.png"
    image.save(destination, dpi=(300, 300))
    print(destination)


if __name__ == "__main__":
    main()
