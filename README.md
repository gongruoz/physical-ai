## phototaxi

AI-powered physical agents that move according to what they see, using a webcam (or phone camera), SiliconFlow vision models, and Arduino + L298N / servo hardware.

### Components 组件概览

- **Gesture servo mode (`npm run gesture`)**  
  - Express + HTTPS server (`gesture-servo-server.js`) serves `public/index.html` + `public/gesture.js`.  
  - Browser uses MediaPipe HandLandmarker to map hand pose → `angle` (0–180°) and `speed` (0.1–3.0), sending JSON `{ angle, speed }` to `POST /move`.  
  - Node forwards this over serial as JSON to an Arduino running a compatible **servo sketch**.

- **Phone camera → AI → motors (`npm run gesture:motors`)**  
  - Same server, but `TARGET=motors`.  
  - `public/gesture.js` captures frames from the phone camera and periodically `POST /frame` with a JPEG data URL and a **camera source** (`eyesight` or `surveillance`).  
  - **Eyesight**: phone is mounted on the bot; the image is the bot’s own view. Server calls `getMotorSequence` (AI plans from “what I see”).  
  - **Surveillance**: phone is fixed elsewhere, looking at the bot; the image is an external view. Server calls `getMotorSequenceFromSurveillance`; the bot’s objective is to **move towards the camera**.  
  - The UI lets you choose which role the phone camera plays; the same vision model produces `{ left, right, duration }` for the two-wheel car.

- **Direct AI → servo (`npm run ai-servo`)**  
  - `ai-servo.js` uses the computer’s webcam (ffmpeg on macOS, or `node-webcam` elsewhere) + SiliconFlow vision model to plan sequences of `{ angle, speed, duration }` for a single servo, streamed over serial as JSON.

- **Direct AI → motors (`npm run ai-motors`)**  
  - `ai-motors.js` captures frames from the computer’s webcam and asks the model to output a short driving script:  
    `[{ "left": -1..1, "right": -1..1, "duration": ms }, ...]`, which is sent over serial.

### Hardware & Arduino 硬件与 Arduino

- **Two-wheel car with L298N**  
  - Use the sketch in `arduino/ai_motors_l298n/ai_motors_l298n.ino`.  
  - Protocol: each serial line is JSON like `{"left":0.7,"right":0.7,"duration":500}`.  
  - Wiring and details are documented in `arduino/README.md`.

- **Servo mode**  
  - Expect Arduino firmware that listens for one JSON per line: `{"angle":0–180,"speed":0.1–3.0}` and moves the servo accordingly.  
  - The exact sketch is up to your hardware, but must match this protocol.

### Configuration 配置

- Copy `.env.example` to `.env` (or edit `.env` locally) and set:
  - `SILICONFLOW_API_KEY`: your SiliconFlow API key
  - `SERIAL_PORT`: path to your USB serial device (e.g. `/dev/tty.usbserial-XXXX`)
  - `ESP32_HTTP_URL`: (optional) when using ESP32 as the motor controller in surveillance mode, set to the ESP32 base URL (e.g. `http://192.168.1.100`). AI will output forward/back/left/right and the server will send them via HTTP to the ESP32.
- `.env` is already in `.gitignore` and **must not be committed**.

### Running 运行方式

- **Install dependencies 安装依赖**

```bash
npm install
```

- **Gesture → servo 手势控制舵机**

```bash
npm run gesture
```

Visit `https://localhost:3750` (or LAN IP) in a browser that supports camera over HTTPS, trust the self-signed cert, then use hand pose to control the servo.

- **Phone camera → AI → motors 手机摄像头→AI→双轮电机**

```bash
npm run gesture:motors
```

Open the same URL from your phone on the same Wi‑Fi, enable camera. Choose **Eyesight** (phone on bot, bot drives by what it sees) or **Surveillance** (phone fixed, watching the bot; bot moves towards the camera). Frames are sent to the server and converted into left/right motor commands.

- **Direct AI → servo 直接 AI 控制舵机**

```bash
npm run ai-servo
```

- **Direct AI → motors 直接 AI 控制双轮电机**

```bash
npm run ai-motors
```

### AprilTag 36h11 打印与识别

项目提供 **5 行×6 列** 共 30 个 AprilTag 36h11（ID 0–29）的 A4 排版 PDF，以及摄像头画面中的 tag 识别脚本，便于与 `ai-motors` 抓帧流程对接（例如“看到某 tag 就左转”等逻辑在 Node 里实现）。

- **生成 A4 打印稿**
  - 安装 Python 依赖：`pip install -r scripts/requirements.txt`（若仅生成 PDF，安装 `reportlab`、`requests` 即可）。
  - 运行：`python3 scripts/generate_apriltag_a4.py`。会从 [AprilRobotics/apriltag-imgs](https://github.com/AprilRobotics/apriltag-imgs) 下载 tag36h11 的 0–29 号 PNG 到 `scripts/tag36h11/`（若已有则跳过），并生成 `scripts/apriltag_36h11_5x6_a4.pdf`（**两页**：第 1 页每 tag **3×3 cm**，第 2 页每 tag **2.5×2.5 cm**，每个 tag 下方印有 ID）。
  - 打印时选择 **实际大小 / 100%**，不要缩放，以保证识别距离与精度。

- **识别画面中的 tag**
  - 依赖：`opencv-python`、`apriltag`、`numpy`（见 `scripts/requirements.txt`）。若 `pip install apriltag` 失败（需编译），可尝试在虚拟环境中安装或使用系统 Python。
  - 用法一（文件路径）：`python3 scripts/detect_apriltag.py /path/to/image.jpg`
  - 用法二（stdin）：`cat image.jpg | python3 scripts/detect_apriltag.py`
  - 标准输出为一行的 JSON 数组，例如：`[{"tag_id": 3, "center": [x, y], "corners": [[x,y],...]}, ...]`。

- **用摄像头快速验证**
  - 在 `scripts/` 目录下运行：`python3 test_apriltag_camera.py`。会打开默认摄像头，实时检测画面中的 tag 并在画面上标出 ID 和边框；把打印好的 A4 纸对准摄像头即可确认是否识别正常。按 **q** 退出。

- **与 Node 对接**
  - 在 `ai-motors.js` 中已有 `captureFrameAsDataUrl()` 抓一帧；可将同一帧写入临时文件，再 `child_process.spawn('python3', ['scripts/detect_apriltag.py', tempPath])`，读取 stdout 得到 JSON，根据 `tag_id` 做后续控制（电机指令仍通过串口按 `arduino/README.md` 协议发送）。

### Notes 说明

- Transitional debug hooks, local telemetry, and duplicate Arduino sketches have been removed for clarity.  
- Logs are kept minimal but still show **AI decisions** and **actual serial payloads** to help with troubleshooting.

