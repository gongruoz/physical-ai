/*
 * 双轮小车 + L298N，接收 ai-motors.js 下发的 { "left": -1~1, "right": -1~1, "duration": ms }
 * 依赖: ArduinoJson
 *
 * 当前引脚（Arduino 数字口）:
 *   左轮: ENA=5(PWM), IN1=7, IN2=8
 *   右轮: ENB=6(PWM), IN3=11, IN4=12
 * 若你只接了 5,6,7,8：通常是 ENA=5, ENB=6, IN1=7, IN2=8，右轮方向 IN3/IN4 需接另外两个口（如 9,10 或 11,12），请改下面 IN3/IN4 常量以匹配你的接线。
 */

#include <ArduinoJson.h>

// L298N 引脚（按实际接线修改；你接 5,6,7,8 时请核对：左 ENA,IN1,IN2 = 5,7,8；右 ENB=6，IN3,IN4 改为你用的口）
const int ENA = 5;   // 左轮 PWM
const int IN1 = 7;
const int IN2 = 8;
const int ENB = 6;   // 右轮 PWM
const int IN3 = 11;  // 若右轮方向接的是 9,10 请改为 9 和 10
const int IN4 = 12;

StaticJsonDocument<200> doc;

void setLeftMotor(float value) {
  // value: -1.0 ~ 1.0，负=后退
  int pwm = (int)(fabs(value) * 255.0f);
  pwm = constrain(pwm, 0, 255);
  if (value >= 0) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
  } else {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
  }
  analogWrite(ENA, pwm);
}

void setRightMotor(float value) {
  int pwm = (int)(fabs(value) * 255.0f);
  pwm = constrain(pwm, 0, 255);
  if (value >= 0) {
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
  } else {
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
  }
  analogWrite(ENB, pwm);
}

void setup() {
  Serial.begin(9600);
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  setLeftMotor(0);
  setRightMotor(0);
  delay(1000);
}

void loop() {
  if (Serial.available() <= 0) return;

  String input = Serial.readStringUntil('\n');
  input.trim();
  DeserializationError error = deserializeJson(doc, input);

  if (error) return;

  float left  = doc["left"]  | 0.0f;
  float right = doc["right"] | 0.0f;
  left  = constrain(left,  -1.0f, 1.0f);
  right = constrain(right, -1.0f, 1.0f);

  setLeftMotor(left);
  setRightMotor(right);

  // 回传确认，便于 Node 端日志确认 Arduino 已收到并解析（调试用）
  Serial.print("{\"ok\":1,\"left\":");
  Serial.print(left);
  Serial.print(",\"right\":");
  Serial.println(right);
}
