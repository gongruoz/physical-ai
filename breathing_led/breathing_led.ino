/*
 * 双灯混色呼吸灯：蓝色 + 白色
 * 目标：通过加入白光让蓝色变得不那么“纯蓝”
 */

const int bluePin = 9;    // 蓝色 LED 接 Pin 9
const int whitePin = 10;  // 白色 LED 接 Pin 10
const float period = 5500; // 呼吸周期 5.5 秒

// 调节这个比例来改变色调 (0.0 到 1.0)
// 0.2 表示白光只开到 20% 的亮度，如果你想要更淡的蓝，就调高这个值
const float whiteMixRatio = 0.3; 

void setup() {
  pinMode(bluePin, OUTPUT);
  pinMode(whitePin, OUTPUT);
}

void loop() {
  float time = millis();
  
  // 计算基础呼吸曲线 (0 到 255)
  float angle = 2.0 * PI * (time / period);
  int baseBrightness = 127.5 * (sin(angle - PI/2.0) + 1.0);

  // 蓝色全额输出
  analogWrite(bluePin, baseBrightness*0.1);
  
  // 白色按比例输出，起到“冲淡”颜色的作用
  int whiteBrightness = baseBrightness * whiteMixRatio;
  analogWrite(whitePin, whiteBrightness);

  delay(10); 
}
