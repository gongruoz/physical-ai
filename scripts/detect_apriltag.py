#!/usr/bin/env python3
"""
Detect AprilTag 36h11 in an image; print JSON array of detections to stdout.
Input: image file path as argv[1], or image bytes from stdin.
Output: one JSON line, e.g. [{"tag_id": 3, "center": [x, y], "corners": [[x,y],...]}, ...]

Use from Node: capture frame, write to temp file, spawn this script, parse stdout.
Dependencies: pip install opencv-python apriltag (see scripts/requirements.txt).
"""
import json
import sys
from pathlib import Path

import cv2
import numpy


def detect_gray(gray: numpy.ndarray):
    """Run AprilTag 36h11 detection on a grayscale numpy array; return list of dicts."""
    try:
        import apriltag
    except ImportError:
        print(
            "pip install apriltag opencv-python (see scripts/requirements.txt)",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    detector = apriltag.Detector()
    results = detector.detect(gray)
    out = []
    for r in results:
        out.append({
            "tag_id": int(r.tag_id),
            "center": [float(r.center[0]), float(r.center[1])],
            "corners": [[float(x), float(y)] for x, y in r.corners],
        })
    return out


def detect(image_path: str | None, image_bytes: bytes | None):
    """Run AprilTag 36h11 detection; return list of dicts."""
    if image_bytes is not None:
        buf = numpy.frombuffer(image_bytes, dtype=numpy.uint8)
        gray = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    else:
        gray = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        return []
    return detect_gray(gray)


def main() -> None:
    image_path = None
    image_bytes = None
    if len(sys.argv) >= 2:
        image_path = sys.argv[1]
        if not Path(image_path).exists():
            print(json.dumps([]))
            return
    else:
        if not sys.stdin.isatty():
            image_bytes = sys.stdin.buffer.read()

    if image_path is None and image_bytes is None:
        print("Usage: detect_apriltag.py <image_path>   OR  cat image.jpg | detect_apriltag.py", file=sys.stderr)
        raise SystemExit(1)

    out = detect(image_path, image_bytes)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
