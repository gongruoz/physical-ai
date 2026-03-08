#!/usr/bin/env python3
"""
Live camera test for AprilTag 36h11: open default webcam, detect tags in each frame,
draw tag ID and outline on the image. Point the camera at your printed A4 sheet to verify.
Quit: press 'q' in the window.
Requires: opencv-python, apriltag, numpy (pip install -r scripts/requirements.txt).
"""
import sys
from pathlib import Path

# allow importing detect_gray from sibling
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cv2
import numpy as np

from detect_apriltag import detect_gray


def main() -> None:
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Could not open default camera (0). Try another index or check permissions.", file=sys.stderr)
        raise SystemExit(1)

    print("Point camera at printed AprilTags. Press 'q' in the window to quit.")
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = detect_gray(gray)

        for d in detections:
            tag_id = d["tag_id"]
            center = tuple(int(x) for x in d["center"])
            corners = np.array(d["corners"], dtype=np.int32)
            cv2.polylines(frame, [corners], True, (0, 255, 0), 2)
            cv2.putText(
                frame, str(tag_id), center,
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2,
            )

        cv2.putText(
            frame, f"Tags: {len(detections)} (q=quit)", (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2,
        )
        cv2.imshow("AprilTag test", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
