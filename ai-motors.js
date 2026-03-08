#!/usr/bin/env node
/**
 * AI 双轮小车：eyesight（小车眼前视野）或 surveillance（外部监控）画面 → AI 规划左右电机 → 串口 Arduino + L298N
 * 运行: npm run ai-motors（本机用电脑摄像头模拟 eyesight）
 * 串口协议: 每行一个 JSON，{ "left": -1~1, "right": -1~1, "duration": 毫秒 }
 */
require('dotenv').config();
const { execSync } = require('child_process');
const { SerialPort } = require('serialport');
const NodeWebcam = require('node-webcam');

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const MODEL = 'deepseek-ai/deepseek-vl2';

const apiKey = process.env.SILICONFLOW_API_KEY?.trim();
const userHint =
  process.env.USER_HINT?.trim() ||
  '让小车根据眼前画面朝目标方向前进，避开障碍；画面里有什么就朝哪里走。';

const webcam = NodeWebcam.create({
  width: 640,
  height: 480,
  delay: 0,
  saveShots: false,
  output: 'jpeg',
  device: false,
  callbackReturn: 'buffer',
});

async function captureFrameAsDataUrl() {
  const platform = process.platform;
  if (platform === 'darwin') {
    try {
      const buf = execSync(
        'ffmpeg -y -f avfoundation -framerate 30 -i "0" -vframes 1 -f image2 pipe:1',
        {
          encoding: 'buffer',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 5 * 1024 * 1024,
        }
      );
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (ffmpegErr) {
      const msg =
        ffmpegErr.code === 127 ||
        (ffmpegErr.message && ffmpegErr.message.includes('command not found'))
          ? 'On macOS please install ffmpeg: brew install ffmpeg'
          : ffmpegErr.message;
      throw new Error(msg);
    }
  }
  return new Promise((resolve, reject) => {
    webcam.capture('frame', (err, data) => {
      if (err) return reject(err);
      resolve(`data:image/jpeg;base64,${data.toString('base64')}`);
    });
  });
}

/** AI：根据 eyesight（小车眼前视野）规划左右电机动作序列 */
async function getMotorSequence(imageDataUrl) {
  const textPrompt = `你是一辆两轮小车的驾驶 AI。摄像头装在小车前方，这张图就是小车的 eyesight（眼前视野）。

目标：${userHint}

请按以下格式回复（严格两段）：
1) 第一行：用一句话说「我看到了什么，我决定怎么走」。例如：我看到了正前方有路，我决定直行一段。
2) 空一行后，只写一个 JSON 数组，每个元素格式：{ "left": 左轮动力, "right": 右轮动力, "duration": 毫秒 }

- left / right：范围 -1.0 到 1.0。正数=前进，负数=后退。
- 直行：{"left": 0.7, "right": 0.7, "duration": 500}
- 左转：{"left": 0.2, "right": 0.8, "duration": 400}
- 右转：{"left": 0.8, "right": 0.2, "duration": 400}
- 停车：{"left": 0, "right": 0, "duration": 200}

示例格式：
我看到了前方有障碍，我决定先左转绕开。
[{"left": 0.3, "right": 0.8, "duration": 300}, {"left": 0.6, "right": 0.6, "duration": 500}]
`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'low' },
            },
            { type: 'text', text: textPrompt },
          ],
        },
      ],
      max_tokens: 1200,
    }),
  });

  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content ?? '').trim();

  // 空响应时打印 API 信息（限流/截断/错误）
  if (!text) {
    const err = data?.error;
    const finish = data?.choices?.[0]?.finish_reason;
    const usage = data?.usage;
    console.log('[中间量] AI 返回空内容。', err ? `API error: ${JSON.stringify(err)}` : '', finish ? `finish_reason: ${finish}` : '', usage ? `tokens: ${JSON.stringify(usage)}` : '');
    return [];
  }

  // 打印 AI 的「我看到了什么，我决定怎么走」
  const firstLine = text.split(/\r?\n/)[0]?.trim();
  if (firstLine && !firstLine.startsWith('[')) {
    console.log('\n[AI]', firstLine);
  } else if (text) {
    console.log('\n[AI] 原始回应:', text.slice(0, 300) + (text.length > 300 ? '...' : ''));
  }

  const seq = parseMotorSequenceFromText(text);
  if (seq.length > 0) {
    console.log('[中间量] 本帧收到动作序列:', seq.length, '个', JSON.stringify(seq));
  }
  return seq;
}

/** AI：根据 surveillance（外部监控摄像头）画面规划左右电机动作序列；目标为让小车朝摄像头方向移动 */
async function getMotorSequenceFromSurveillance(imageDataUrl) {
  const textPrompt = `你是一辆两轮小车的驾驶 AI。这张图是**外部监控摄像头**拍到的画面：摄像头固定在某处（例如高处或远处），画面里能看到小车的位置、朝向和周围环境。小车的**唯一目标**是：朝摄像头的方向移动（即朝画面中「镜头/观察者」的方向前进），直到接近摄像头或无法再前进为止。

请根据小车在画面中的位置与朝向，规划一小段左右轮动作，使小车朝摄像头方向移动。输出格式与前述相同。

请按以下格式回复（严格两段）：
1) 第一行：用一句话说「小车在画面中的位置/朝向，我决定怎么走才能朝摄像头靠近」。
2) 空一行后，只写一个 JSON 数组，每个元素格式：{ "left": 左轮动力, "right": 右轮动力, "duration": 毫秒 }

- left / right：范围 -1.0 到 1.0。正数=前进，负数=后退。
- 直行：{"left": 0.7, "right": 0.7, "duration": 500}
- 左转：{"left": 0.2, "right": 0.8, "duration": 400}
- 右转：{"left": 0.8, "right": 0.2, "duration": 400}
- 停车：{"left": 0, "right": 0, "duration": 200}

示例格式：
小车在画面偏左，车头朝右，我决定先右转再直行以朝摄像头方向靠近。
[{"left": 0.8, "right": 0.2, "duration": 300}, {"left": 0.6, "right": 0.6, "duration": 500}]
`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'low' },
            },
            { type: 'text', text: textPrompt },
          ],
        },
      ],
      max_tokens: 1200,
    }),
  });

  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content ?? '').trim();

  if (!text) {
    const err = data?.error;
    const finish = data?.choices?.[0]?.finish_reason;
    const usage = data?.usage;
    console.log('[中间量] AI 返回空内容。', err ? `API error: ${JSON.stringify(err)}` : '', finish ? `finish_reason: ${finish}` : '', usage ? `tokens: ${JSON.stringify(usage)}` : '');
    return [];
  }

  const firstLine = text.split(/\r?\n/)[0]?.trim();
  if (firstLine && !firstLine.startsWith('[')) {
    console.log('\n[AI surveillance]', firstLine);
  } else if (text) {
    console.log('\n[AI surveillance] 原始回应:', text.slice(0, 300) + (text.length > 300 ? '...' : ''));
  }

  const seq = parseMotorSequenceFromText(text);
  if (seq.length > 0) {
    console.log('[中间量] 本帧 surveillance 动作序列:', seq.length, '个', JSON.stringify(seq));
  }
  return seq;
}

/** AI：surveillance 模式，直接输出「前/后/左/右」指令序列，供 ESP32 HTTP 使用；目标仍是朝摄像头靠近 */
async function getMotorSequenceFromSurveillanceDirections(imageDataUrl) {
  const textPrompt = `你是一辆两轮小车的驾驶 AI。这张图是**外部监控摄像头**拍到的画面：摄像头固定在某处，画面里能看到小车的位置、朝向和周围环境。小车的**唯一目标**是：朝摄像头的方向移动（朝画面中镜头的方向前进）。

请根据小车在画面中的位置与朝向，规划一小段动作，只使用四种方向：前进(forward)、后退(back)、左转(left)、右转(right)。输出一个 JSON 数组，每个元素：{ "direction": "forward" 或 "back" 或 "left" 或 "right", "duration": 毫秒 }。

请按以下格式回复（严格两段）：
1) 第一行：用一句话说「小车在画面中的位置/朝向，我决定怎么走才能朝摄像头靠近」。
2) 空一行后，只写一个 JSON 数组。例如：[{"direction":"right","duration":300},{"direction":"forward","duration":500}]

- direction 只能是：forward, back, left, right
- duration：该动作持续毫秒数，建议 200~600

示例格式：
小车在画面偏左，车头朝右，我决定先右转再直行以朝摄像头靠近。
[{"direction":"right","duration":300},{"direction":"forward","duration":500}]
`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
            { type: 'text', text: textPrompt },
          ],
        },
      ],
      max_tokens: 800,
    }),
  });

  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content ?? '').trim();

  if (!text) {
    const err = data?.error;
    const finish = data?.choices?.[0]?.finish_reason;
    console.log('[中间量] AI 返回空内容。', err ? `API error: ${JSON.stringify(err)}` : '', finish ? `finish_reason: ${finish}` : '');
    return [];
  }

  const firstLine = text.split(/\r?\n/)[0]?.trim();
  if (firstLine && !firstLine.startsWith('[')) {
    console.log('\n[AI surveillance directions]', firstLine);
  }

  const seq = parseDirectionSequenceFromText(text);
  if (seq.length > 0) {
    console.log('[中间量] 本帧 surveillance 方向序列:', seq.length, '个', JSON.stringify(seq));
  }
  return seq;
}

function parseDirectionSequenceFromText(text) {
  const jsonStr = text.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonStr) return [];
  const normalized = jsonStr.replace(/\b(direction|duration)\s*:/g, '"$1":');
  const dirMap = { forward: 'forward', back: 'back', left: 'left', right: 'right' };
  for (const toTry of [normalized, normalized + ']', normalized.replace(/,(\s*)$/, '$1]')]) {
    try {
      const arr = JSON.parse(toTry);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((o) => {
          const d = (o.direction || o.dir || '').toString().toLowerCase();
          const dir = dirMap[d] || (d === '前' || d === 'fwd' ? 'forward' : d === '后' ? 'back' : d === '左' ? 'left' : d === '右' ? 'right' : null);
          const duration = Math.max(0, Math.min(5000, Number(o.duration) || 300));
          return dir ? { direction: dir, duration } : null;
        })
        .filter(Boolean);
    } catch (_) {
      continue;
    }
  }
  return [];
}

/** 从 AI 回复中解析 JSON 数组，兼容单引号、未加引号的 key、截断等 */
function parseMotorSequenceFromText(text) {
  let jsonStr = text.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonStr) {
    console.log('[中间量] AI 未返回有效 JSON 数组，原始长度:', text.length);
    return [];
  }
  // 兼容 AI 常出的格式：{ left: 0.8, right: 0.3 } → 把 key 改成双引号
  jsonStr = jsonStr.replace(/\b(left|right|duration)\s*:/g, '"$1":');
  for (const toTry of [jsonStr, jsonStr + ']', jsonStr.replace(/,(\s*)$/, '$1]')]) {
    try {
      const arr = JSON.parse(toTry);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      continue;
    }
  }
  console.error('[中间量] 解析 AI 返回失败，原始:', text.slice(0, 250));
  return [];
}

function clamp(v) {
  return Math.max(-1, Math.min(1, Number(v) || 0));
}

/**
 * 在已打开的串口上运行：截帧 → AI（我看到了什么，我决定怎么走）→ 下发 left/right/duration
 * 所有中间量会 print 到 console。
 */
function runMotorsLoop(port) {
  let actionQueue = [];

  async function executeSequence() {
    if (actionQueue.length === 0) {
      try {
        console.log('[中间量] 截帧完成，请求 AI...');
        const imageDataUrl = await captureFrameAsDataUrl();
        actionQueue = await getMotorSequence(imageDataUrl);
        if (actionQueue.length === 0) {
          console.log('[中间量] AI 返回空序列，1s 后重试');
          setTimeout(executeSequence, 1000);
          return;
        }
      } catch (err) {
        console.error('[中间量] 摄像头或 AI 失败:', err.message);
        setTimeout(executeSequence, 1000);
        return;
      }
    }

    const action = actionQueue.shift();
    if (action) {
      const left = clamp(action.left);
      const right = clamp(action.right);
      const duration = Math.max(0, Math.min(5000, Number(action.duration) || 300));
      const payload = JSON.stringify({ left, right, duration }) + '\n';
      console.log(`[执行] left=${left.toFixed(2)} right=${right.toFixed(2)} duration=${duration}ms → 串口: ${payload.trim()}`);

      if (port?.isOpen) port.write(payload);
      setTimeout(executeSequence, duration);
    } else {
      setTimeout(executeSequence, 1000);
    }
  }

  console.log('--- 摄像头→AI→电机 已启动（prompt: 我看到了什么，我决定怎么走）---');
  executeSequence();
}

async function main() {
  const ports = await SerialPort.list();
  const portPath =
    process.env.SERIAL_PORT || ports.find((p) => /tty|usb|cu/i.test(p.path))?.path;

  if (!portPath) {
    console.error('未找到串口设备。');
    process.exit(1);
  }

  const port = new SerialPort({ path: portPath, baudRate: 9600 });
  await new Promise((resolve) => port.once('open', resolve));

  console.log('--- AI 双轮小车已就位，根据摄像头画面调整步伐 ---');
  runMotorsLoop(port);
}

// 供 gesture 服务器在 TARGET=motors 时复用。getMotorSequence = eyesight；getMotorSequenceFromSurveillance = 监控视角(left/right)；getMotorSequenceFromSurveillanceDirections = 监控视角(前/后/左/右)，供 ESP32 HTTP
module.exports = {
  captureFrameAsDataUrl,
  getMotorSequence,
  getMotorSequenceFromSurveillance,
  getMotorSequenceFromSurveillanceDirections,
  parseDirectionSequenceFromText,
  clamp,
  runMotorsLoop,
};

if (require.main === module) {
  main().catch(console.error);
}
