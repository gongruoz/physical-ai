# Arduino 与 ai-motors 配合说明

## 1. 串口协议（与 ai-motors.js 一致）

电脑端每行发一个 JSON：

```json
{"left": 0.7, "right": 0.7, "duration": 500}
```

- **left / right**：`-1.0`～`1.0`。正数=该轮前进，负数=后退；绝对值表示动力强弱。
- **duration**：毫秒，由电脑端等待，Arduino 只根据当前这条指令驱动电机；下一条指令可能是 `{"left":0,"right":0}` 表示停车。

## 2. L298N 接线示意

```
Arduino          L298N
  5 (PWM)  --->  ENA   (左轮速度)
  7        --->  IN1   (左轮方向)
  8        --->  IN2
  6 (PWM)  --->  ENB   (右轮速度)
  11       --->  IN3   (右轮方向)
  12       --->  IN4

L298N 的 OUT1、OUT2 接左电机；OUT3、OUT4 接右电机。
电源、地按 L298N 说明接好（电机电源与 Arduino 共地）。
```

### ENA / ENB 跳线（重要）

- **ENA 和 ENB 不要用跳线连在一起**。它们互相独立：ENA 管左桥、ENB 管右桥。
- 常见 L298N 模块上，**ENA、ENB 位置各有一个跳线帽**：
  - **要用 Arduino 的 PWM 调速**：请**拔掉** ENA、ENB 上的跳线帽，再用杜邦线把 Arduino 的 5 → ENA、6 → ENB 接好。否则板子可能把 ENA/ENB 内部拉高，忽略你接的线，电机不转或不受控。
  - 若跳线帽一直插着，有的板子会忽略 ENA/ENB 外接信号，导致一侧或两侧电机不动。
- 检查顺序：先确认 ENA、ENB 跳线已拔 → 再确认 5→ENA、6→ENB 接线牢靠 → 最后上电测试。

引脚在 `ai_motors_l298n.ino` 顶部常量里，按你实际接线改：

```cpp
const int ENA = 5;   // 左轮 PWM
const int IN1 = 7;
const int IN2 = 8;
const int ENB = 6;   // 右轮 PWM
const int IN3 = 11;
const int IN4 = 12;
```

## 3. 库依赖

- 安装 **ArduinoJson**（库管理器里搜 ArduinoJson，或 [GitHub](https://github.com/bblanchon/ArduinoJson)）。

## 4. 使用流程

1. 烧录 `ai_motors_l298n` 到板子，USB 连电脑。
2. 摄像头接电脑（或后续可改为小车上的摄像头通过 WiFi 推流）。
3. 在项目根目录执行：`npm run ai-motors`。
4. 程序会不断拍一张图 → 调用 AI 得到一段 `{ left, right, duration }` 序列 → 按条通过串口发给 Arduino，Arduino 驱动 L298N 两路电机。

## 5. 和舵机版对比

| 项目       | ai-servo (舵机)     | ai-motors (L298N 双轮)   |
|------------|---------------------|---------------------------|
| 串口格式   | `{"angle":0-180,"speed":0.1-3}` | `{"left":-1~1,"right":-1~1,"duration":ms}` |
| Arduino 逻辑 | 线性插值到目标角度 | 直接设置左右轮 PWM + 方向 |
| 节奏/时长 | 由 speed + 插值步进控制 | 由电脑按 duration 发下一条指令 |
