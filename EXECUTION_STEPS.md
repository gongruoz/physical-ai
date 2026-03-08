# 小车 + 手机摄像头 + AI 执行步骤

**不必给 ESP32 配家里 WiFi（STA）**。用「只开热点」的方式：电脑和手机都连小车的热点，电脑用 `http://192.168.4.1` 发指令即可。

---

## 一、硬件与接线

1. **L298N 与 ESP32/ESP8266**
   - IN1 → GPIO 4、IN2 → GPIO 5、IN3 → GPIO 6、IN4 → GPIO 7
   - ENA、ENB 用跳线帽接高电平（不接 MCU）

2. **供电**：按你现有方式给 L298N 和板子供电（共地）

---

## 二、烧录固件（只开热点，不连家里 WiFi）

1. 用 Arduino IDE 打开：`arduino/esp32_motors_wifi/esp32_motors_wifi.ino`
2. 开发板选你的型号（如 ESP32S3 / ESP8266 等）
3. **不要**取消注释 `WIFI_STA_SSID` / `WIFI_STA_PASS`，保持只开热点
4. 烧录，打开串口（115200），确认看到 `AP IP: 192.168.4.1` 和 “Web server started”

---

## 三、电脑环境

1. 进入项目目录并安装依赖（若未装过）：
   ```bash
   cd /Users/jane/dev/phototaxi
   npm install
   ```

2. 在项目根目录建 `.env`：
   ```bash
   SILICONFLOW_API_KEY=你的SiliconFlow密钥
   ESP32_HTTP_URL=http://192.168.4.1
   ```
   **热点模式下小车固定是 192.168.4.1，就写这个地址。**

---

## 四、用 AI 监控（电脑 + 手机都连小车热点）

1. **电脑**连小车的热点 **ESP32-Car**（密码 `12345678`）。
   - 电脑还需要能上外网（调 AI 接口）：用**网线**或**手机 USB 共享网络**（见下方「手机 USB 供网」）。

---

### 手机通过数据线给电脑供网（USB 共享网络）

电脑连 ESP32-Car 后没有外网，可用数据线让手机把移动网络共享给电脑。

**iPhone（Mac）**

1. 用数据线连接 iPhone 和 Mac。
2. 手机上：**设置 → 蜂窝网络 → 蜂窝数据** 打开；再 **设置 → 个人热点**，打开 **允许其他人加入**（若提示，选「仅 USB」更省电）。
3. Mac 上：菜单栏点 Wi-Fi 图标，在列表里会多出 **iPhone** 或「个人热点」；或 **系统设置 → 网络** 里会多出「iPhone USB」并显示已连接。此时 Mac 通过 iPhone 上网。
4. 保持 **Mac 的 Wi-Fi 仍连接 ESP32-Car**（不要切到 iPhone 热点）。这样 Mac 同时具备：Wi-Fi = 小车热点（和手机、小车同网段），上网 = iPhone USB。若 Mac 自动把默认出口改成了 iPhone，一般无需改；若上不了网，在 **系统设置 → 网络** 里把「iPhone USB」的服务顺序拖到上面试试。

**Android（Mac）**

1. 用数据线连接手机和 Mac。
2. 手机上：**设置 → 网络和互联网 → 热点和网络共享**，打开 **USB 网络共享**（或「通过 USB 共享网络」）。
3. Mac 上：**系统设置 → 网络** 里会出现新的网络接口（如「USB 10/100/1000 LAN」等），状态为已连接即可上网。
4. 同样保持 **Mac 的 Wi-Fi 连接 ESP32-Car**，不要断开。上网走 USB，访问小车和手机走 Wi-Fi。

**若 Mac 只能选一个网络**

- 有的机型会「连 USB 共享后自动断 Wi-Fi」。可先插好 USB 并打开手机共享，再在 Mac 上**先连 ESP32-Car 热点**，看是否仍能上网；若不能，在 **系统设置 → 网络** 里确认两个接口都在，并尝试调整服务顺序（Wi-Fi 在上、USB 在下，或反过来试一次），保证既有外网又能访问 192.168.4.x。

2. **在项目目录启动**：
   ```bash
   npm run gesture:motors
   ```
   终端会打印本机在热点下的地址，例如：`https://192.168.4.2:3750`（以实际为准）。

3. **手机**也连热点 **ESP32-Car**，浏览器用 **HTTPS** 打开上一步的地址（如 `https://192.168.4.2:3750`），首次访问点「高级」→「继续访问」信任证书。

4. 在页面选「监控 (Surveillance)」→「开启摄像头与手势」，允许后置摄像头，对准小车。

5. 流程：手机拍画面 → 电脑跑 AI → 电脑向 `http://192.168.4.1` 发前/后/左/右 → 小车朝摄像头走；约每 0.8 秒一帧。

---

## 五、仅用手动遥控（不跑电脑）

- 手机连热点 **ESP32-Car**（密码 `12345678`）
- 浏览器打开：**http://192.168.4.1**
- 用页面上的「前/后/左/右」按钮控制（按住动，松开停）

---

## 六、不用电脑：服务推上线，手机直接跑（推荐）

电脑只有一个 WiFi、不想用 USB 供网时，可以把「AI 接口」部署到云端，手机连小车热点后打开一个页面即可，**不需要开电脑、不用 terminal**。

### 6.1 把 API 部署到云端

项目里有一个只做「收图 → 调 AI → 返回方向」的服务：`api-cloud.js`。把它部署到任意能跑 Node 的主机（如 **Railway**、**Render**、自己的 VPS），并设置环境变量 `SILICONFLOW_API_KEY`。

**Railway 示例（免费额度可用）**

1. 打开 [railway.app](https://railway.app)，用 GitHub 登录，New Project → Deploy from GitHub repo（先把自己的项目推到 GitHub）。
2. 在项目里选根目录，设置 **Start Command** 为：`node api-cloud.js`（或 `npm run api:cloud`）。
3. 在 Variables 里添加：`SILICONFLOW_API_KEY` = 你的密钥。
4. Deploy 后记下生成的公网地址，例如：`https://phototaxi-xxx.up.railway.app`（**不要**末尾斜杠）。

**Render / 其他**

- 新建 Web Service，根目录，启动命令：`npm run api:cloud` 或 `node api-cloud.js`。
- 环境变量加 `SILICONFLOW_API_KEY`。
- 记下分配给的 HTTPS 地址。

### 6.2 手机上的操作（无需电脑、无需 terminal）

1. 手机连小车的热点 **ESP32-Car**（密码 `12345678`）。
2. 浏览器打开（把 `https://你的部署地址` 换成上面记下的地址）：
   ```text
   http://192.168.4.1/ai?api=https://你的部署地址
   ```
   例如：`http://192.168.4.1/ai?api=https://phototaxi-xxx.up.railway.app`
3. 点「开启摄像头」，允许使用后置摄像头，对准小车。
4. 此时：手机拍画面 → 通过**移动网络**发到云端 → 云端 AI 返回方向 → 页面再通过**小车热点**把指令发给 192.168.4.1 → 小车朝摄像头走。**全程不用电脑。**

注意：手机连的是 ESP32-Car 热点（无外网），访问云端 API 会走**蜂窝数据**（需开启移动数据）。若页面一直报「错误」或发帧失败，请在系统设置里确认：在连 WiFi 时仍允许使用移动数据（如 iOS「无线局域网助理」、Android「在 WLAN 不佳时使用移动数据」等），以便访问云端；发给小车的请求走 WiFi（192.168.4.1）。

---

## 小结：要不要加家里 WiFi（STA）？

| 方式 | 做法 | 何时用 |
|------|------|--------|
| **不加 STA（推荐先试）** | 不配 WIFI_STA_SSID/PASS，只开热点。电脑和手机都连 **ESP32-Car**，`.env` 里 `ESP32_HTTP_URL=http://192.168.4.1` | 加 STA 后跑不通、或想少配置时 |
| **云端 API + 手机直连** | 部署 `api-cloud.js` 到 Railway/Render，手机连热点后打开 `http://192.168.4.1/ai?api=https://你的部署地址` | 电脑只有一个 WiFi、不想用电脑时 |
| 加 STA | 在 .ino 里填家里 WiFi，烧录后记串口里的 STA IP，`.env` 里写 `ESP32_HTTP_URL=http://该IP`，电脑和手机连**家里 WiFi** | 希望电脑、手机照常用家里 WiFi 时 |
