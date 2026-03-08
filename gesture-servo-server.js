#!/usr/bin/env node
/**
 * 手势舵机服务：提供摄像头+MediaPipe 手势界面，并通过串口控制舵机
 * 手机访问必须用 HTTPS 才能用摄像头。运行: npm run gesture
 */
require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { SerialPort } = require('serialport');

const CERT_DIR = __dirname;
const KEY_PATH = path.join(CERT_DIR, 'gesture-key.pem');
const CERT_PATH = path.join(CERT_DIR, 'gesture-cert.pem');

function ensureHttpsCert() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) return;
  console.log('正在生成自签名证书（首次运行）…');
  execSync(
    'openssl req -x509 -newkey rsa:2048 -keyout gesture-key.pem -out gesture-cert.pem -days 365 -nodes -subj /CN=phototaxi',
    { stdio: 'inherit', cwd: CERT_DIR }
  );
}

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const PORT = process.env.GESTURE_PORT || 3750;
const app = express();

// 手机发图可能较大，放宽 body 限制
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let serialPort = null;

// motors 模式：用手机发来的帧驱动，不占用电脑摄像头
let motorsActionQueue = [];
let motorsExecuting = false;
// ESP32 模式（surveillance + 前/后/左/右）：ESP32_HTTP_URL 存在时使用
let directionQueue = [];
let esp32Executing = false;
const ESP32_HTTP_URL = process.env.ESP32_HTTP_URL?.trim() || '';
// 等 Arduino 回传后再发下一条，避免发送过快导致串口缓冲被冲掉
let serialIncomingBuffer = '';
let waitingForEcho = false;
let echoTimeoutId = null;
let lastDuration = 300;

async function openSerial() {
  const ports = await SerialPort.list();
  const portPath =
    process.env.SERIAL_PORT ||
    ports.find((p) => /tty|usb|cu/i.test(p.path))?.path;

  if (!portPath) {
    console.warn('未找到串口，舵机命令将仅打印到控制台');
    return null;
  }

  const port = new SerialPort({ path: portPath, baudRate: 9600 });
  await new Promise((resolve, reject) => {
    port.once('open', resolve);
    port.once('error', reject);
  });
  if (process.env.TARGET === 'motors') {
    port.on('data', (data) => {
      serialIncomingBuffer += data.toString();
      while (serialIncomingBuffer.includes('\n')) {
        const idx = serialIncomingBuffer.indexOf('\n');
        const line = serialIncomingBuffer.slice(0, idx).trim();
        serialIncomingBuffer = serialIncomingBuffer.slice(idx + 1);
        if (line.includes('"ok"') && waitingForEcho) {
          if (echoTimeoutId) clearTimeout(echoTimeoutId);
          echoTimeoutId = null;
          waitingForEcho = false;
          setTimeout(runMotorsExecute, lastDuration);
          return;
        }
      }
    });
  }
  console.log('串口已打开:', portPath);
  return port;
}

// 接收前端发来的 angle/speed，转发到 Arduino（与 ai-servo 相同协议）
app.post('/move', (req, res) => {
  const { angle, speed } = req.body || {};
  const a = Math.max(0, Math.min(180, Number(angle)));
  const s = Math.max(0.1, Math.min(3, Number(speed)));

  const payload = JSON.stringify({ angle: a, speed: s }) + '\n';

  if (serialPort?.isOpen) {
    serialPort.write(payload);
  } else {
    console.log('串口未连接，模拟:', payload.trim());
  }

  res.json({ ok: true, angle: a, speed: s });
});

app.get('/health', (req, res) => {
  const isMotors = process.env.TARGET === 'motors';
  res.json({
    ok: true,
    serial: serialPort?.isOpen ?? false,
    target: isMotors ? 'motors' : 'servo',
  });
});

// 手机摄像头→AI→电机：接收前端发来的一帧（data URL）和 source（eyesight | surveillance），调用对应 AI 并下发电机指令
app.post('/frame', async (req, res) => {
  const isMotors = process.env.TARGET === 'motors';
  if (!isMotors) {
    return res.status(400).json({ error: '当前为舵机模式，不支持 /frame' });
  }
  const imageDataUrl = req.body?.image;
  if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
    return res.status(400).json({ error: '需要 body.image 为 data:image/...;base64,...' });
  }
  const source = req.body?.source === 'surveillance' ? 'surveillance' : 'eyesight';
  const useEsp32 = ESP32_HTTP_URL && source === 'surveillance';

  const ai = require('./ai-motors.js');
  const getSeq = useEsp32
    ? ai.getMotorSequenceFromSurveillanceDirections
    : source === 'surveillance'
      ? ai.getMotorSequenceFromSurveillance
      : ai.getMotorSequence;
  try {
    console.log(`[中间量] 收到手机一帧 (${source}${useEsp32 ? ', ESP32 方向' : ''})，请求 AI...`);
    const seq = await getSeq(imageDataUrl);
    if (Array.isArray(seq) && seq.length === 0) {
      console.log('[中间量] AI 返回空序列');
      return res.json({ ok: true, actions: 0 });
    }
    if (useEsp32) {
      directionQueue = seq;
      if (!esp32Executing) runEsp32Execute();
      return res.json({ ok: true, actions: directionQueue.length });
    }
    motorsActionQueue = seq;
    if (!motorsExecuting) runMotorsExecute();
    res.json({ ok: true, actions: motorsActionQueue.length });
  } catch (err) {
    console.error('[中间量] 处理手机帧失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function runEsp32Execute() {
  if (directionQueue.length === 0) {
    esp32Executing = false;
    return;
  }
  esp32Executing = true;
  const action = directionQueue.shift();
  const dir = action.direction || 'forward';
  const duration = Math.max(0, Math.min(5000, Number(action.duration) || 300));
  const url = `${ESP32_HTTP_URL.replace(/\/$/, '')}/cmd?dir=${encodeURIComponent(dir)}&duration=${duration}`;
  console.log(`[执行 ESP32] ${dir} ${duration}ms → ${url}`);
  fetch(url).catch((err) => console.error('[执行 ESP32] 请求失败:', err.message));
  setTimeout(runEsp32Execute, duration);
}

function runMotorsExecute() {
  if (motorsActionQueue.length === 0) {
    motorsExecuting = false;
    return;
  }
  motorsExecuting = true;
  const action = motorsActionQueue.shift();
  const { clamp } = require('./ai-motors.js');
  const left = clamp(action.left);
  const right = clamp(action.right);
  const duration = Math.max(0, Math.min(5000, Number(action.duration) || 300));
  const payload = JSON.stringify({ left, right, duration }) + '\n';
  console.log(`[执行] left=${left.toFixed(2)} right=${right.toFixed(2)} duration=${duration}ms → 串口: ${payload.trim()}`);
  lastDuration = duration;
  if (serialPort?.isOpen) {
    serialPort.write(payload, (err) => {
      if (err) {
        console.error('[执行] 串口写入失败', err.message);
        waitingForEcho = false;
        setTimeout(runMotorsExecute, duration);
        return;
      }
      // 必须 drain：等数据真正发到设备，否则会堆在 OS 缓冲里，进程退出时才 flush 到 Arduino
      serialPort.drain((drainErr) => {
        if (drainErr) console.error('[执行] 串口 drain 失败', drainErr.message);
        waitingForEcho = true;
        if (echoTimeoutId) clearTimeout(echoTimeoutId);
        echoTimeoutId = setTimeout(() => {
          echoTimeoutId = null;
          if (waitingForEcho) {
            waitingForEcho = false;
            setTimeout(runMotorsExecute, duration);
          }
        }, 800);
      });
    });
  } else {
    console.warn('[执行] 串口未连接，未写入。请接上 Arduino 并烧录 ai_motors_l298n.ino（双轮 left/right 协议）');
    setTimeout(runMotorsExecute, duration);
  }
}

async function main() {
  serialPort = await openSerial();

  const isMotors = process.env.TARGET === 'motors';
  if (isMotors && ESP32_HTTP_URL) {
    console.log('ESP32 模式: surveillance 时使用 前/后/左/右 指令发往', ESP32_HTTP_URL);
  }
  if (isMotors && serialPort?.isOpen) {
    console.log('串口模式: motors（手机摄像头→AI→电机），用手机打开页面并开启摄像头，帧会发到 POST /frame');
    console.log('若电机不动：请确认 Arduino 已烧录 ai_motors_l298n.ino（双轮 left/right），不是舵机程序');
  } else if (serialPort?.isOpen) {
    console.log('串口模式: servo（手势→舵机），POST /move 发送 angle/speed');
  }

  const host = process.env.HOST || '0.0.0.0';
  const useHttps = process.env.USE_HTTPS !== '0';

  if (useHttps) {
    ensureHttpsCert();
    const server = https.createServer(
      {
        key: fs.readFileSync(KEY_PATH),
        cert: fs.readFileSync(CERT_PATH),
      },
      app
    );
    server.listen(PORT, host, () => {
      const ips = getLocalIPs();
      const scheme = 'https';
      const addr = ips.length ? `${scheme}://${ips[0]}:${PORT}` : `${scheme}://<本机IP>:${PORT}`;
      console.log('');
      console.log('---');
      console.log(`  手机打开（同 WiFi）: ${addr}`);
      console.log('  首次需点「高级」→「继续访问」信任证书');
      if (isMotors) {
        console.log('  选「监控 (Surveillance)」+ 开启摄像头 → 小车朝摄像头走');
        if (ESP32_HTTP_URL) console.log('  ESP32 指令发往:', ESP32_HTTP_URL);
      } else {
        console.log('  用手势控制舵机：食指左右→角度，手掌高低→速度');
      }
      console.log('---');
      console.log(`手势界面: ${scheme}://localhost:${PORT}`);
      if (ips.length > 1) ips.slice(1).forEach((ip) => console.log(`  或: ${scheme}://${ip}:${PORT}`));
    });
  } else {
    app.listen(PORT, host, () => {
      const ips = getLocalIPs();
      const scheme = 'http';
      const addr = ips.length ? `${scheme}://${ips[0]}:${PORT}` : `${scheme}://<本机IP>:${PORT}`;
      console.log('');
      console.log('---');
      console.log(`  手机打开（同 WiFi）: ${addr}`);
      if (isMotors) {
        console.log('  选「监控 (Surveillance)」+ 开启摄像头 → 小车朝摄像头走');
        if (ESP32_HTTP_URL) console.log('  ESP32 指令发往:', ESP32_HTTP_URL);
      } else {
        console.log('  （HTTP 下手机摄像头不可用，建议用 HTTPS）');
        console.log('  用手势控制舵机：食指左右→角度，手掌高低→速度');
      }
      console.log('---');
      console.log(`手势界面: ${scheme}://localhost:${PORT}`);
      if (ips.length > 1) ips.slice(1).forEach((ip) => console.log(`  或: ${scheme}://${ip}:${PORT}`));
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
