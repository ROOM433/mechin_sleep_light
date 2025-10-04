# 🛏️ 스마트 수면 알람 시스템

ESP32 기반의 수면 패턴 분석을 통한 스마트 알람 시스템입니다. 라즈베리파이 서버와 휴대폰 웹 인터페이스를 통해 원격으로 제어할 수 있습니다.

## 📁 프로젝트 구조

```
mechin_sleep_light/
├── ESP32_SleepMonitor/           # ESP32용 펌웨어
│   ├── esp32_sleep_monitor.ino   # 메인 Arduino 코드
│   └── README.md                 # ESP32 설정 가이드
├── RaspberryPi_Server/          # 라즈베리파이용 서버
│   ├── server.js                # Node.js 서버
│   ├── package.json             # 의존성 관리
│   ├── start.sh                 # 실행 스크립트
│   ├── public/                  # 웹 인터페이스
│   │   ├── index.html           # 메인 웹 페이지
│   │   ├── app.js              # 클라이언트 JavaScript
│   │   └── style.css           # 스타일시트
│   └── README.md                # 서버 설정 가이드
└── README.md                    # 이 파일
```

## 🚀 빠른 시작

### 1단계: 라즈베리파이 서버 설정

```bash
# 라즈베리파이에서 실행
cd RaspberryPi_Server
chmod +x start.sh
./start.sh
```

### 2단계: ESP32 펌웨어 업로드

1. Arduino IDE에서 `ESP32_SleepMonitor/esp32_sleep_monitor.ino` 열기
2. WiFi 정보와 라즈베리파이 IP 주소 설정
3. ESP32에 업로드

### 3단계: 휴대폰에서 접속

- 같은 WiFi: `http://[라즈베리파이IP]:8080`
- 외부 네트워크: `http://[공인IP]:8080`

## 🔧 하드웨어 구성

### 필요한 부품
- ESP32 개발보드
- ADXL345 가속도계 센서
- 부저 (알람용)
- LED (상태 표시용)
- 점퍼 와이어
- 라즈베리파이 (서버용)

### 연결 방법
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

## 🌐 네트워크 설정

### 라즈베리파이 IP 확인
```bash
hostname -I
```

### 포트 포워딩 (외부 접근용)
- 라우터 설정에서 포트 8080을 라즈베리파이 IP로 포워딩
- 동적 DNS 사용 권장 (DuckDNS 등)

## 📱 사용법

1. **디바이스 연결**: ESP32가 라즈베리파이 서버에 연결되면 웹에서 확인 가능
2. **알람 설정**: 목표 기상 시간을 입력하고 알람 설정
3. **모니터링 시작**: 수면 데이터 수집 시작
4. **실시간 모니터링**: 웹에서 수면 상태와 차트 확인
5. **알람 발생**: 설정된 시간에 ESP32에서 알람 발생

## 🔬 핵심 기능

### 수면 단계 분석
- **움직임 점수** 기반 수면 단계 판단
- 깨어있음/얕은잠/깊은잠 3단계 분류
- 실시간 데이터 시각화

### 90분 사이클 알람
- 인간의 생체리듬 기반 설계
- 목표 시간에서 역산하여 최적 알람 시간 계산
- 얕은잠 단계에서 자연스러운 기상

### 원격 제어
- 휴대폰 웹 인터페이스로 모든 기능 제어
- 실시간 데이터 모니터링
- 알람 설정 및 취소

## 🛠️ 문제 해결

### ESP32 연결 문제
- WiFi 설정 확인
- 라즈베리파이 IP 주소 확인
- 시리얼 모니터에서 오류 메시지 확인

### 서버 접근 문제
- 라즈베리파이 IP 주소 재확인
- 방화벽 설정 확인
- 포트 포워딩 설정 확인

### 센서 데이터 문제
- ADXL345 연결 확인
- I2C 주소 확인 (기본값: 0x53)
- 전원 공급 확인

## 📊 기술 스택

### 하드웨어
- **ESP32**: WiFi 내장 마이크로컨트롤러
- **ADXL345**: 3축 가속도계 센서
- **라즈베리파이**: 서버 호스팅

### 소프트웨어
- **Arduino IDE**: ESP32 펌웨어 개발
- **Node.js**: 백엔드 서버
- **Express.js**: 웹 프레임워크
- **WebSocket**: 실시간 통신
- **Bootstrap**: 웹 UI 프레임워크
- **Chart.js**: 데이터 시각화

## 🔒 보안 고려사항

- 로컬 네트워크 내에서만 기본 동작
- 외부 접근 시 포트 포워딩 필요
- HTTPS 설정 권장 (Let's Encrypt)
- 방화벽 설정으로 보안 강화

## 📈 향후 개선 계획

- [ ] 머신러닝 기반 수면 패턴 학습
- [ ] 다중 사용자 지원
- [ ] 모바일 앱 개발
- [ ] 데이터베이스 연동
- [ ] 수면 리포트 생성
- [ ] 음성 알람 기능

## 📄 라이선스

MIT License

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 지원

문제가 발생하면 다음을 확인하세요:

1. **ESP32**: 시리얼 모니터 출력 확인
2. **라즈베리파이**: 서버 로그 확인 (`sudo journalctl -f`)
3. **네트워크**: 연결 상태 확인 (`ping google.com`)
4. **웹 브라우저**: 개발자 도구 콘솔 확인

---

**즐거운 수면 되세요! 😴**