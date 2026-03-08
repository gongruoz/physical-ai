#!/usr/bin/env node
/**
 * 云端 API：只做「收图 → 调 AI → 返回方向」。
 * 部署到 Railway / Render / 任意 Node 主机后，手机连小车热点、打开 http://192.168.4.1/ai?api=https://你的部署地址 即可用摄像头+AI 驱动小车，无需电脑。
 */
require('dotenv').config();
const express = require('express');
// 云端用无原生依赖的版本，避免 Railway 构建 serialport 失败
const { getMotorSequenceFromSurveillanceDirections } = require('./ai-surveillance-cloud.js');

const app = express();
app.use(express.json({ limit: '8mb' }));

// 允许从 ESP32 页面 (http://192.168.4.1) 或任意来源调用
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'phototaxi-api-cloud',
    usage: 'POST /frame with body { image: "data:image/...;base64,...", source: "surveillance" }',
    health: 'GET /health',
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'phototaxi-api-cloud' });
});

app.post('/frame', async (req, res) => {
  const imageDataUrl = req.body?.image;
  if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
    return res.status(400).json({ error: '需要 body.image 为 data:image/...;base64,...' });
  }
  try {
    const directions = await getMotorSequenceFromSurveillanceDirections(imageDataUrl);
    res.json({ ok: true, directions: Array.isArray(directions) ? directions : [] });
  } catch (err) {
    console.error('[api-cloud] frame error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3751;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`phototaxi API (cloud) listening on port ${PORT}`);
  console.log('Set SILICONFLOW_API_KEY in env. POST /frame with { image: dataUrl } → returns { directions }.');
});
