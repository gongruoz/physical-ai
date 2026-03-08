#!/usr/bin/env python3
"""
Generate an A4 PDF with two pages: 5×6 AprilTag 36h11 (IDs 0–29).
Page 1: each tag 3×3 cm. Page 2: each tag 2.5×2.5 cm. Each tag has its ID printed below.
Uses pre-generated PNGs from AprilRobotics/apriltag-imgs; downloads to script dir if missing.
Print at 100% / actual size for reliable detection.
"""
from pathlib import Path
import sys

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm, cm
    import requests
except ImportError as e:
    print("Install dependencies: pip install -r scripts/requirements.txt", file=sys.stderr)
    raise SystemExit(1) from e

# Layout: A4, 5 rows × 6 columns, 30 tags (IDs 0–29)
ROWS = 5
COLS = 6
TAG_IDS = list(range(ROWS * COLS))  # 0..29
A4_W_MM = 210
A4_H_MM = 297
MARGIN_MM = 10
LABEL_HEIGHT_CM = 0.45   # space for ID text below tag
GAP_CM = 0.2             # gap between tag and label
CELL_PAD_CM = 0.1        # horizontal padding between cells
BASE_URL = "https://raw.githubusercontent.com/AprilRobotics/apriltag-imgs/master/tag36h11"
SCRIPT_DIR = Path(__file__).resolve().parent
TAGS_DIR = SCRIPT_DIR / "tag36h11"
OUTPUT_PDF = SCRIPT_DIR / "apriltag_36h11_5x6_a4.pdf"
FONT_SIZE = 9


def ensure_tag_png(tag_id: int) -> Path:
    """Return path to tag PNG; download if not present."""
    TAGS_DIR.mkdir(exist_ok=True)
    name = f"tag36_11_{tag_id:05d}.png"
    path = TAGS_DIR / name
    if path.exists():
        return path
    url = f"{BASE_URL}/{name}"
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            path.write_bytes(r.content)
            return path
        except (requests.RequestException, OSError) as e:
            if attempt == 2:
                raise SystemExit(
                    f"Download failed for {name}. Get it from {url} and save to {TAGS_DIR}"
                ) from e
    return path


def draw_page(c, paths, tag_size_cm: float) -> None:
    """Draw one A4 page: 5×6 grid of tags at tag_size_cm × tag_size_cm with ID below each."""
    w_pt = A4_W_MM * mm
    h_pt = A4_H_MM * mm
    margin_pt = MARGIN_MM * mm
    usable_w = w_pt - 2 * margin_pt
    usable_h = h_pt - 2 * margin_pt

    tag_pt = tag_size_cm * cm
    label_h_pt = LABEL_HEIGHT_CM * cm
    gap_pt = GAP_CM * cm
    cell_pad_pt = CELL_PAD_CM * cm

    cell_w_pt = tag_pt + 2 * cell_pad_pt
    cell_h_pt = tag_pt + gap_pt + label_h_pt

    # Center the grid in usable area
    grid_w = COLS * cell_w_pt
    grid_h = ROWS * cell_h_pt
    left_pt = margin_pt + (usable_w - grid_w) / 2
    bottom_pt = margin_pt + (usable_h - grid_h) / 2

    c.setFont("Helvetica", FONT_SIZE)
    idx = 0
    for row in range(ROWS):
        for col in range(COLS):
            cell_x = left_pt + col * cell_w_pt
            cell_y = bottom_pt + row * cell_h_pt
            # Label at bottom of cell
            label_y = cell_y + label_h_pt / 2 - FONT_SIZE * 0.35
            c.drawCentredString(
                cell_x + cell_w_pt / 2,
                label_y,
                str(TAG_IDS[idx]),
            )
            # Tag image above label
            tag_x = cell_x + cell_pad_pt
            tag_y = cell_y + label_h_pt + gap_pt
            img_path = paths[idx]
            c.drawImage(
                str(img_path),
                tag_x,
                tag_y,
                width=tag_pt,
                height=tag_pt,
                preserveAspectRatio=True,
                anchor="c",
            )
            idx += 1


def main() -> None:
    print("Ensuring tag36h11 PNGs (0–29)...")
    paths = [ensure_tag_png(i) for i in TAG_IDS]

    w_pt = A4_W_MM * mm
    h_pt = A4_H_MM * mm
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=(w_pt, h_pt))

    print("Page 1: 3×3 cm tags...")
    draw_page(c, paths, 3.0)
    c.showPage()

    print("Page 2: 2.5×2.5 cm tags...")
    draw_page(c, paths, 2.5)
    c.save()

    print(f"Wrote {OUTPUT_PDF} (2 pages: 3×3 cm, 2.5×2.5 cm; each tag has ID below).")
    print("Print at 100% / actual size for reliable camera detection.")


if __name__ == "__main__":
    main()
