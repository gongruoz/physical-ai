/**
 * 摄像头 + MediaPipe 手部关键点 → 舵机角度与速度
 * 或 motors 模式：手机摄像头画面 → POST /frame → AI → 电机
 */
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MOTORS_FRAME_INTERVAL_MS = 800; // 手机摄像头每 0.8 秒发一帧给 AI→电机（边看边发、边跑边改）

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const handStatusEl = document.getElementById('handStatus');
const angleValEl = document.getElementById('angleVal');
const speedValEl = document.getElementById('speedVal');
const btnStart = document.getElementById('btnStart');

let handLandmarker = null;
let lastSend = { angle: null, speed: null };
let isBackCamera = false;
const SEND_THROTTLE_MS = 80;
let isMotorsMode = false;
let motorsFrameTimer = null;
let motorsFrameCount = 0;

function setStatus(msg, isError = false) {
  handStatusEl.textContent = msg;
  handStatusEl.className = isError ? 'error' : 'ok';
}

function setAngleSpeed(angle, speed) {
  angleValEl.textContent = angle != null ? Math.round(angle) + '°' : '—';
  speedValEl.textContent = speed != null ? speed.toFixed(2) : '—';
}

function sendMove(angle, speed) {
  const a = Math.max(0, Math.min(180, angle));
  const s = Math.max(0.1, Math.min(3, speed));
  setAngleSpeed(a, s);

  if (lastSend.angle === a && lastSend.speed === s) return;
  lastSend = { angle: a, speed: s };

  fetch('/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ angle: a, speed: s }),
  }).catch((err) => setStatus('发送失败: ' + err.message, true));
}

function drawLandmarks(landmarks) {
  if (!landmarks?.length) return;
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  landmarks.forEach((p, i) => {
    const x = p.x * canvas.width;
    const y = p.y * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // 食指指尖高亮
  const i8 = landmarks[8];
  if (i8) {
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(i8.x * canvas.width, i8.y * canvas.height, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function initMediaPipe() {
  const { HandLandmarker, FilesetResolver } = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
  );
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL },
    numHands: 1,
    runningMode: 'video',
  });
  setStatus('手势就绪');
  return handLandmarker;
}

function getFacingMode() {
  const params = new URLSearchParams(location.search);
  if (params.get('camera') === 'back') return 'environment';
  if (params.get('camera') === 'front') return 'user';
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return 'environment';
  return 'user';
}

function getUserMediaCompat(constraints) {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacy =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia;
  if (!legacy) {
    throw new Error('此浏览器不支持摄像头 API，请用系统浏览器 (Safari/Chrome) 打开');
  }
  return new Promise((resolve, reject) => {
    legacy.call(navigator, constraints, resolve, reject);
  });
}

async function startCamera() {
  const stream = await getUserMediaCompat({
    video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, facingMode: getFacingMode() },
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });
  video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  isBackCamera = getFacingMode() === 'environment';
  const view = document.querySelector('.view');
  if (view) view.classList.toggle('camera-back', isBackCamera);
  setStatus('摄像头已开');
}

let lastDetectTime = 0;
function detectFrame() {
  if (!handLandmarker || video.readyState < 2) {
    requestAnimationFrame(detectFrame);
    return;
  }
  const now = performance.now();
  if (now - lastDetectTime < SEND_THROTTLE_MS) {
    requestAnimationFrame(detectFrame);
    return;
  }
  lastDetectTime = now;

  const ts = performance.now();
  const results =
    typeof handLandmarker.detectForVideo === 'function'
      ? handLandmarker.detectForVideo(video, ts)
      : handLandmarker.detect(video, ts);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const hands = results?.landmarks ?? [];
  if (hands.length === 0) {
    setStatus('未检测到手');
    setAngleSpeed(null, null);
    requestAnimationFrame(detectFrame);
    return;
  }

  const landmarks = hands[0];
  drawLandmarks(landmarks);

  // 手腕 0, 食指指尖 8
  const wrist = landmarks[0];
  const indexTip = landmarks[8];
  const x = indexTip.x; // 0..1, 左→右（视频坐标系）
  const y = wrist.y;    // 0..1, 上→下

  // 后置不镜像时画面=真实方向，角度与画面一致（手在左→小角度，在右→大角度）
  const angle = x * 180;
  const speed = 0.1 + (1 - y) * 2.9; // 手在上方→快，下方→慢
  sendMove(angle, speed);
  setStatus('跟踪中');

  requestAnimationFrame(detectFrame);
}

function getCameraSource() {
  const radio = document.querySelector('input[name="cameraSource"]:checked');
  return (radio && radio.value === 'surveillance') ? 'surveillance' : 'eyesight';
}

function setHintByCameraSource() {
  const hint = document.querySelector('.hint');
  if (!hint || !isMotorsMode) return;
  const source = getCameraSource();
  if (source === 'surveillance') {
    hint.textContent = '手机固定对准小车；AI 让小车朝摄像头方向移动';
  } else {
    hint.textContent = '用手机当小车眼睛，AI 根据眼前画面控制左右轮';
  }
}

async function initPageMode() {
  try {
    const r = await fetch('/health');
    const data = await r.json();
    isMotorsMode = data.target === 'motors';
    if (isMotorsMode) {
      const h1 = document.querySelector('h1');
      if (h1) h1.textContent = '手机摄像头 → AI → 电机';
      const cameraRoleRow = document.getElementById('cameraRoleRow');
      if (cameraRoleRow) cameraRoleRow.style.display = 'flex';
      const viewParam = new URLSearchParams(location.search).get('view');
      if (viewParam === 'surveillance') {
        const sur = document.querySelector('input[name="cameraSource"][value="surveillance"]');
        if (sur) sur.checked = true;
      }
      setHintByCameraSource();
      const statusRow = document.querySelector('.status');
      if (statusRow) {
        angleValEl.textContent = '—';
        speedValEl.textContent = '—';
      }
      document.querySelectorAll('input[name="cameraSource"]').forEach((el) => {
        el.addEventListener('change', setHintByCameraSource);
      });
    }
  } catch (e) {
    console.warn('无法获取 /health，按舵机模式运行', e);
  }
}

function startMotorsFrameLoop() {
  if (motorsFrameTimer) return;
  motorsFrameCount = 0;
  function sendFrame() {
    if (video.readyState < 2 || !ctx) {
      motorsFrameTimer = setTimeout(sendFrame, 500);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    const source = getCameraSource();
    fetch('/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, source }),
    })
      .then((res) => res.json())
      .then((d) => {
        motorsFrameCount += 1;
        setStatus(`已发送 ${motorsFrameCount} 帧 → AI→电机`);
      })
      .catch((err) => setStatus('发送失败: ' + err.message, true));
    motorsFrameTimer = setTimeout(sendFrame, MOTORS_FRAME_INTERVAL_MS);
  }
  sendFrame();
}

btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  try {
    await startCamera();
    if (isMotorsMode) {
      setStatus('手机摄像头已开，正在向服务器发送画面…');
      startMotorsFrameLoop();
    } else {
      await initMediaPipe();
      detectFrame();
    }
  } catch (e) {
    setStatus('错误: ' + e.message, true);
    btnStart.disabled = false;
  }
});

initPageMode();
