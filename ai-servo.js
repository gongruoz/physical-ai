#!/usr/bin/env node
require('dotenv').config();
const { execSync } = require('child_process');
const { SerialPort } = require('serialport');
const NodeWebcam = require('node-webcam');

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
// 使用支持视觉输入的模型
const MODEL = 'deepseek-ai/deepseek-vl2';

const apiKey = process.env.SILICONFLOW_API_KEY?.trim();
const userHint =
  process.env.USER_HINT?.trim() ||
  '表演：一个人悄悄走路，接着奔跑，然后摔倒，戛然而止。';

let actionQueue = [];

// 初始化摄像头（使用默认设备），仅在不使用 ffmpeg 时用到
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
      const msg = ffmpegErr.code === 127 || (ffmpegErr.message && ffmpegErr.message.includes('command not found'))
        ? 'On macOS please install ffmpeg for webcam: brew install ffmpeg'
        : ffmpegErr.message;
      throw new Error(msg);
    }
  }

  return new Promise((resolve, reject) => {
    webcam.capture('frame', (err, data) => {
      if (err) {
        return reject(err);
      }
      const base64 = data.toString('base64');
      resolve(`data:image/jpeg;base64,${base64}`);
    });
  });
}

/** AI 导演模式：根据当前角度 + 摄像头画面规划一小段舵机动作 */
async function getDirectorSequence(currentAngle, imageDataUrl) {
  const textPrompt = `你是一个舵机动作编舞导演。
当前舵机角度: ${currentAngle} 度。
目标表演: ${userHint}

我会不断给你提供你面前的画面，请你根据当前画面，移动舵机，把它当作你的腿，规划接下来一小段舵机动作序列，行走到你面前最近的一个物体旁边。

请按以下格式回复（严格两段）：
1) 第一行：用一句话说「我看到了什么，我决定怎么走/怎么动」。例如：我看到了左边的杯子，我决定先向左迈几步。
2) 空一行后，只写一个 JSON 数组，每个对象 { "angle": 0-180, "speed": 0.1-3.0, "duration": 毫秒 }。
- angle: 目标角度 (0-180)
- speed: 动作速度 (0.1 很慢，3.0 很快)
- duration: 完成该动作后停顿的毫秒数

示例格式：
我看到了正前方的椅子，我决定慢慢抬腿向前走。
[{"angle": 90, "speed": 0.2, "duration": 1000}, {"angle": 120, "speed": 2.5, "duration": 200}]`;

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
              image_url: {
                url: imageDataUrl,
                detail: 'low',
              },
            },
            {
              type: 'text',
              text: textPrompt,
            },
          ],
        },
      ],
      max_tokens: 1200,
    }),
  });

  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content ?? '').trim();

  // 打印 AI 的「我看到了什么，我决定怎么走」
  const firstLine = text.split(/\r?\n/)[0]?.trim();
  if (firstLine && !firstLine.startsWith('[')) {
    console.log('\n[AI]', firstLine);
  } else if (text) {
    console.log('\n[AI] 原始回应:', text.slice(0, 300) + (text.length > 300 ? '...' : ''));
  }

  try {
    const jsonStr = text.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) {
      console.log('[中间量] AI 未返回有效 JSON 数组，原始长度:', text.length);
      return [];
    }
    const arr = JSON.parse(jsonStr);
    const seq = Array.isArray(arr) ? arr : [];
    console.log('[中间量] 本帧收到动作序列:', seq.length, '个', JSON.stringify(seq));
    return seq;
  } catch (e) {
    console.error('[中间量] 解析剧本失败，原始回复:', text.slice(0, 200));
    return [];
  }
}

async function main() {
  const ports = await SerialPort.list();
  const portPath = process.env.SERIAL_PORT || ports.find(p => /tty|usb|cu/i.test(p.path))?.path;

  if (!portPath) {
    console.error('未找到串口设备。');
    process.exit(1);
  }

  const port = new SerialPort({ path: portPath, baudRate: 9600 });
  await new Promise((resolve) => port.once('open', resolve));

  console.log('--- 导演已就位，支持视觉 + 速度与节奏控制 ---');

  let currentAngle = 90;

  async function executeSequence() {
    if (actionQueue.length === 0) {
      try {
        console.log('[中间量] 截帧完成，请求 AI（prompt: 我看到了什么，我决定怎么动）...');
        const imageDataUrl = await captureFrameAsDataUrl();
        actionQueue = await getDirectorSequence(currentAngle, imageDataUrl);
        if (actionQueue.length === 0) {
          console.log('[中间量] AI 返回空序列，1s 后重试');
          setTimeout(executeSequence, 1000);
          return;
        }
      } catch (err) {
        console.error('[中间量] 获取摄像头画面或 AI 序列失败:', err.message);
        setTimeout(executeSequence, 1000);
        return;
      }
    }

    const action = actionQueue.shift();
    if (action) {
      const payload = JSON.stringify({ angle: action.angle, speed: action.speed }) + '\n';
      console.log(`[执行] 角度 ${action.angle}, 速度 ${action.speed}, 等待 ${action.duration || 500}ms → 串口: ${payload.trim()}`);

      port.write(payload);

      if (typeof action.angle === 'number') {
        currentAngle = action.angle;
      }

      setTimeout(executeSequence, action.duration || 500);
    } else {
      setTimeout(executeSequence, 1000);
    }
  }

  executeSequence();
}

main().catch(console.error);