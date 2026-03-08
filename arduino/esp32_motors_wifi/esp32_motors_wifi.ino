#include <WiFi.h>
#include <WebServer.h>

// ===== 小车引脚 (已更改为更安全的 GPIO 4, 5, 6, 7) =====
const int IN1 = 4;
const int IN2 = 5;
const int IN3 = 6;
const int IN4 = 7;

// ===== 热点设置 =====
const char* AP_SSID = "ESP32-Car";
const char* AP_PASS = "12345678";   // 至少8位

WebServer server(80);

// ===== 网页 (使用 PROGMEM 节省 RAM) =====
const char MAIN_page[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ESP32 小车控制</title>
  <style>
    body{ font-family: system-ui, sans-serif; text-align:center; margin:0; padding:24px; background:#f5f5f5; }
    h2{ margin-bottom:8px; }
    .ip{ color:#666; margin-bottom:18px; }
    .pad{ display:grid; grid-template-columns:90px 90px 90px; gap:12px; justify-content:center; margin-top:20px; }
    button{ height:72px; font-size:18px; border:none; border-radius:16px; background:white; box-shadow:0 2px 10px rgba(0,0,0,.08); cursor:pointer; touch-action:manipulation; }
    button:active{ transform:scale(0.98); background:#eaeaea; }
    .wide{ grid-column:2/3; }
  </style>
</head>
<body>
  <h2>ESP32 小车遥控</h2>
  <div class="pad">
    <div></div><button data-cmd="w">前进</button><div></div>
    <button data-cmd="a">左转</button><button data-cmd="x">停止</button><button data-cmd="d">右转</button>
    <div></div><button data-cmd="s" class="wide">后退</button><div></div>
  </div>
<script>
function sendCmd(cmd){ fetch('/cmd?c=' + cmd); }
let holdTimer = null;
function startHold(cmd){ stopHold(); sendCmd(cmd); if(cmd !== 'x') holdTimer = setInterval(() => sendCmd(cmd), 120); }
function stopHold(){ if(holdTimer){ clearInterval(holdTimer); holdTimer = null; } }
document.querySelectorAll('button[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', e => startHold(btn.dataset.cmd));
  btn.addEventListener('mouseup', e => { stopHold(); sendCmd('x'); });
  btn.addEventListener('touchstart', e => { e.preventDefault(); startHold(btn.dataset.cmd); }, {passive:false});
  btn.addEventListener('touchend', e => { stopHold(); sendCmd('x'); });
});
</script>
</body>
</html>
)rawliteral";

// ===== AI 监控页：手机连热点后打开 /ai?api=https://你的云端地址，无需电脑 =====
const char AI_page[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AI 监控</title>
  <style>
    body{font-family:system-ui,sans-serif;text-align:center;margin:0;padding:16px;background:#111;color:#eee;}
    h2{margin-bottom:4px;}
    .hint{color:#888;font-size:14px;margin-bottom:12px;}
    #video{width:100%;max-width:320px;border-radius:8px;background:#000;}
    #status{margin:12px 0;min-height:24px;}
    button{padding:12px 24px;font-size:16px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;}
    button:disabled{opacity:0.5;}
  </style>
</head>
<body>
  <h2>AI 监控</h2>
  <p class="hint" id="hint">地址后加 ?api=https://你的云端地址</p>
  <video id="video" autoplay playsinline muted></video>
  <div id="status"></div>
  <button id="btn">开启摄像头</button>
  <script>
  (function(){
    var video=document.getElementById('video');
    var canvas=document.createElement('canvas');
    var ctx=canvas.getContext('2d');
    var statusEl=document.getElementById('status');
    var hint=document.getElementById('hint');
    var btn=document.getElementById('btn');
    var apiBase='';
    var pending=[];
    var interval=800;
    function getApi(){
      var m=location.search.match(/api=([^&]+)/);
      return m ? decodeURIComponent(m[1]).replace(/\/+$/,'') : '';
    }
    function setStatus(s){ statusEl.textContent=s; }
    function runDirections(dirs){
      pending.forEach(clearTimeout);
      pending=[];
      var t=0;
      (dirs||[]).forEach(function(a){
        var d=Math.min(5000,Math.max(0,a.duration||300));
        pending.push(setTimeout(function(){
          fetch('/cmd?dir='+encodeURIComponent((a.direction||'stop'))+'&duration='+d).catch(function(){});
        },t));
        t+=d;
      });
    }
    function loop(){
      if(!apiBase||video.readyState<2){ setTimeout(loop,500); return; }
      canvas.width=video.videoWidth;
      canvas.height=video.videoHeight;
      ctx.drawImage(video,0,0);
      var dataUrl=canvas.toDataURL('image/jpeg',0.65);
      fetch(apiBase+'/frame',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({image:dataUrl,source:'surveillance'})
      }).then(function(r){ return r.json(); }).then(function(d){
        if(d.directions&&d.directions.length){ runDirections(d.directions); }
        setStatus('已发帧 → AI → 小车');
      }).catch(function(e){ setStatus('错误: '+e.message); });
      setTimeout(loop,interval);
    }
    btn.onclick=function(){
      apiBase=getApi();
      if(!apiBase){ hint.textContent='请在地址后加 ?api=https://你的云端地址'; return; }
      hint.textContent='';
      btn.disabled=true;
      navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:640,height:480}})
        .then(function(stream){ video.srcObject=stream; video.onloadedmetadata=function(){ video.play(); loop(); }; })
        .catch(function(e){ setStatus('摄像头错误: '+e.message); btn.disabled=false; });
    };
  })();
  </script>
</body>
</html>
)rawliteral";

// ===== 电机控制 =====
void stopCar() { digitalWrite(IN1, LOW); digitalWrite(IN2, LOW); digitalWrite(IN3, LOW); digitalWrite(IN4, LOW); }
void forward() { digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW); digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW); }
void backward() { digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH); digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH); }
void left() { digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH); digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW); }
void right() { digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW); digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH); }

// ===== 定时到点停车（AI 发 dir+duration 时用）=====
unsigned long motorUntil = 0;

// ===== 路由 =====
void handleRoot() { server.send_P(200, "text/html", MAIN_page); }
void handleAi() { server.send_P(200, "text/html", AI_page); }
void handleCmd() {
  String dir = server.arg("dir");
  String c = server.arg("c");
  int duration = server.arg("duration").toInt();
  if (duration > 5000) duration = 500;

  // 电脑 AI 发的是 dir + duration
  if (dir.length() > 0) {
    dir.toLowerCase();
    if (dir == "forward" || dir == "前" || dir == "fwd") { forward(); motorUntil = duration > 0 ? millis() + (unsigned long)duration : 0; }
    else if (dir == "back" || dir == "后" || dir == "backward") { backward(); motorUntil = duration > 0 ? millis() + (unsigned long)duration : 0; }
    else if (dir == "left" || dir == "左") { left(); motorUntil = duration > 0 ? millis() + (unsigned long)duration : 0; }
    else if (dir == "right" || dir == "右") { right(); motorUntil = duration > 0 ? millis() + (unsigned long)duration : 0; }
    else { stopCar(); motorUntil = 0; }
    server.send(200, "application/json", "{\"ok\":1}");
    return;
  }
  // 内置遥控页发的是 c=w/a/s/d/x
  if (c == "w") forward();
  else if (c == "s") backward();
  else if (c == "a") left();
  else if (c == "d") right();
  else stopCar();
  motorUntil = 0;
  server.send(200, "text/plain", "OK");
}

void setup() {
  Serial.begin(115200);
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  stopCar();
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());
  server.on("/", handleRoot);
  server.on("/ai", handleAi);
  server.on("/cmd", handleCmd);
  server.begin();
  Serial.println("Web server started. 电脑/手机连此热点后: 遥控 http://192.168.4.1  AI用ESP32_HTTP_URL=http://192.168.4.1");
}

void loop() {
  if (motorUntil > 0 && millis() >= motorUntil) {
    stopCar();
    motorUntil = 0;
  }
  server.handleClient();
}
