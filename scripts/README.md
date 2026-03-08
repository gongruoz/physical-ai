# AprilTag 36h11 scripts

- **generate_apriltag_a4.py** — Builds one A4 PDF with **two pages**: page 1 has 5×6 tag36h11 at **3×3 cm** each, page 2 at **2.5×2.5 cm** each; each tag has its ID (0–29) printed below. Run: `python3 generate_apriltag_a4.py`. Requires: `reportlab`, `requests`. PNGs are downloaded to `tag36h11/` on first run. Print at 100% scale.
- **detect_apriltag.py** — Detects tag36h11 in an image; prints JSON to stdout. Run: `python3 detect_apriltag.py <image_path>` or pipe image bytes to stdin. Requires: `opencv-python`, `apriltag`, `numpy`. See project root README for Node integration.
- **test_apriltag_camera.py** — Live camera test: opens the default webcam, detects tags in each frame and draws ID + outline on the image. Run: `python3 test_apriltag_camera.py` from the `scripts/` directory, point the camera at the printed sheet, press **q** to quit. Use this to verify that your printed AprilTags are detected.

Install deps: `pip install -r requirements.txt`
