/**
 * 仅用于云端部署：只做「图 → SiliconFlow → 方向序列」，无 serialport/node-webcam 等原生依赖。
 * api-cloud.js 部署到 Railway 时用此文件，避免 npm install 编译失败。
 */
require('dotenv').config();

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const MODEL = 'deepseek-ai/deepseek-vl2';
const apiKey = process.env.SILICONFLOW_API_KEY?.trim();

async function getMotorSequenceFromSurveillanceDirections(imageDataUrl) {
  if (!apiKey) {
    console.error('[ai-surveillance-cloud] SILICONFLOW_API_KEY not set');
    return [];
  }
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
    console.log('[ai-surveillance-cloud] AI 返回空', err ? JSON.stringify(err) : '', finish || '');
    return [];
  }

  return parseDirectionSequenceFromText(text);
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

module.exports = { getMotorSequenceFromSurveillanceDirections };
