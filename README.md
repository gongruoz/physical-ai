## phototaxi

AI-powered physical agents that move according to what they see, using a webcam (or phone camera), SiliconFlow vision models, and Arduino + L298N / servo hardware.

### Components 组件概览

- **Gesture servo mode (`npm run gesture`)**  
  - Express + HTTPS server (`gesture-servo-server.js`) serves `public/index.html` + `public/gesture.js`.  
  - Browser uses MediaPipe HandLandmarker to map hand pose → `angle` (0–180°) and `speed` (0.1–3.0), sending JSON `{ angle, speed }` to `POST /move`.  
  - Node forwards this over serial as JSON to an Arduino running a compatible **servo sketch**.

- **Phone camera → AI → motors (`npm run gesture:motors`)**  
  - Same server, but `TARGET=motors`.  
  - `public/gesture.js` captures frames from the phone camera and periodically `POST /frame` with a JPEG data URL.  
  - Server calls `getMotorSequence` from `ai-motors.js`, which uses SiliconFlow vision model `deepseek-ai/deepseek-vl2` to generate a sequence of `{ left, right, duration }` commands for a two-wheel car.

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

Open the same URL from your phone on the same Wi‑Fi, enable camera; frames will be sent to the server and converted into left/right motor commands.

- **Direct AI → servo 直接 AI 控制舵机**

```bash
npm run ai-servo
```

- **Direct AI → motors 直接 AI 控制双轮电机**

```bash
npm run ai-motors
```

### Notes 说明

- Transitional debug hooks, local telemetry, and duplicate Arduino sketches have been removed for clarity.  
- Logs are kept minimal but still show **AI decisions** and **actual serial payloads** to help with troubleshooting.

