# ESP32 스마트 수면 알람 시스템

## 📋 필요한 라이브러리

Arduino IDE에서 다음 라이브러리들을 설치해주세요:

1. **WiFi** (ESP32 기본 라이브러리)
2. **WebSocketsClient** by Markus Sattler
3. **ArduinoJson** by Benoit Blanchon
4. **Wire** (ESP32 기본 라이브러리)

## 🔧 설정 방법

### 1. WiFi 설정
`esp32_sleep_monitor.ino` 파일에서 다음 부분을 수정하세요:

```cpp
#define WIFI_SSID     "YOUR_WIFI_SSID"        // 실제 WiFi 이름
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"    // 실제 WiFi 비밀번호
#define SERVER_HOST   "192.168.1.100"        // 라즈베리파이 IP 주소
```

### 2. 하드웨어 연결

```
ESP32    ADXL345
------   -------
3.3V  -> VCC
GND   -> GND
21    -> SDA
22    -> SCL

ESP32    부저/LED
------   --------
2     -> 부저 (+)
GND   -> 부저 (-)
4     -> LED (+)
GND   -> LED (-)
```

### 3. 업로드
- Arduino IDE에서 ESP32 보드를 선택
- 포트 설정
- 업로드 실행

## 📱 사용법

1. ESP32를 전원에 연결
2. 시리얼 모니터에서 WiFi 연결 상태 확인
3. 라즈베리파이 서버가 실행 중인지 확인
4. 휴대폰에서 웹 인터페이스 접속

## 🔍 문제 해결

### WiFi 연결 안됨
- WiFi 이름과 비밀번호 확인
- ESP32와 라우터 거리 확인
- 시리얼 모니터에서 오류 메시지 확인

### 서버 연결 안됨
- 라즈베리파이 IP 주소 확인
- 라즈베리파이 서버 실행 상태 확인
- 방화벽 설정 확인

### 센서 데이터 없음
- ADXL345 연결 확인
- I2C 주소 확인 (기본값: 0x53)
- 전원 공급 확인
