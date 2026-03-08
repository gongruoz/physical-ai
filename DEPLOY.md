# 最简单稳定部署：Railway + 手机直连小车

用 **Railway** 部署云端 AI 接口，手机连小车热点后打开一个链接即可。**不需要电脑在场。**

---

## 第一步：准备密钥和代码

1. 打开 [SiliconFlow 控制台](https://cloud.siliconflow.cn/) 或你用的视觉 API 平台，复制 **API Key**。
2. 本地项目根目录的 `.env` 里要有这一行（仅本地跑时用，部署用 Railway 的变量）：
   ```bash
   SILICONFLOW_API_KEY=你的密钥
   ```
3. 把整个项目推到 **GitHub**（若还没推）：
   ```bash
   cd /Users/jane/dev/phototaxi
   git add .
   git commit -m "add cloud api and deploy config"
   git remote add origin https://github.com/你的用户名/phototaxi.git   # 若已存在可跳过
   git push -u origin main
   ```

---

## 第二步：在 Railway 部署

1. 打开 **https://railway.app**，用 **GitHub 账号**登录。
2. 点 **「New Project」** → 选 **「Deploy from GitHub repo」**。
3. 选中你的 **phototaxi** 仓库（若列表没有，先点 **Configure GitHub** 授权）。
4. 部署开始后，点进这个 **Service**（紫色方块）。
5. 点 **「Variables」**（或 Settings → Variables），点 **「+ New Variable」**：
   - **Name**：`SILICONFLOW_API_KEY`
   - **Value**：粘贴你的 API Key  
   保存。
6. 点 **「Settings」**，找到 **Build & Deploy**：
   - **Start Command** 填：`npm start`  
   （项目里 `npm start` 已配置为跑 `api-cloud.js`，不填 Railway 也会尝试 `npm start`。）
7. 若刚加过变量或改过设置，点 **「Redeploy」** 重新部署一次。
8. 在 **「Settings」** 里找到 **「Networking」** → **「Generate Domain」**，生成一个公网域名，例如：  
   `https://phototaxi-production-xxxx.up.railway.app`  
   **复制这个地址，不要带末尾斜杠。**

---

## 第三步：小车固件

1. 给 ESP32 烧录 **arduino/esp32_motors_wifi/esp32_motors_wifi.ino**（确保里面有 **/ai** 页面）。
2. 上电后小车热点：**ESP32-Car**，密码：**12345678**。

---

## 第四步：手机操作（不用电脑）

1. 手机连接 WiFi **ESP32-Car**（密码 12345678）。
2. 打开浏览器，在地址栏输入（把 `https://你的域名.up.railway.app` 换成第二步里复制的地址）：
   ```text
   http://192.168.4.1/ai?api=https://你的域名.up.railway.app
   ```
   例如：
   ```text
   http://192.168.4.1/ai?api=https://phototaxi-production-xxxx.up.railway.app
   ```
3. 打开后点 **「开启摄像头」**，允许使用**后置摄像头**，对准小车。
4. 小车会按 AI 指令朝摄像头方向移动。全程无需电脑。

---

## 小结

| 步骤 | 做什么 |
|------|--------|
| 1 | 准备 API Key，把代码推到 GitHub |
| 2 | Railway 从 GitHub 部署，加变量 `SILICONFLOW_API_KEY`，生成域名并复制 |
| 3 | 小车烧录固件、开热点 ESP32-Car |
| 4 | 手机连热点，浏览器打开 `http://192.168.4.1/ai?api=你的Railway域名`，开摄像头 |

**若页面报错或发帧失败**：确认手机在连小车热点时仍能用**移动数据**（在系统设置里打开「无线局域网助理」或「在 WLAN 不佳时使用移动数据」），否则无法访问云端 API。
