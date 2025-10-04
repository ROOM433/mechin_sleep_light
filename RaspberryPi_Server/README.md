# 🍓 라즈베리파이용 스마트 수면 알람 서버

라즈베리파이에서 실행되는 스마트 수면 알람 시스템의 백엔드 서버입니다.

## 📋 시스템 요구사항

- **라즈베리파이**: 3B+ 이상 권장
- **운영체제**: Raspberry Pi OS (Raspbian)
- **Node.js**: 14.0.0 이상
- **메모리**: 최소 1GB RAM
- **저장공간**: 최소 2GB 여유 공간

## 🚀 설치 및 실행

### 1. Node.js 설치

```bash
# Node.js 18.x 설치
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 설치 확인
node --version
npm --version
```

### 2. 프로젝트 설정

```bash
# 프로젝트 폴더로 이동
cd RaspberryPi_Server

# 의존성 설치
npm install

# 실행 권한 부여
chmod +x start.sh
```

### 3. 서버 실행

```bash
# 방법 1: 스크립트 사용
./start.sh

# 방법 2: 직접 실행
npm start

# 방법 3: 개발 모드 (자동 재시작)
npm run dev
```

## 🌐 네트워크 설정

### 라즈베리파이 IP 주소 확인

```bash
# 현재 IP 주소 확인
hostname -I

# 또는
ip addr show wlan0 | grep inet
```

### 방화벽 설정 (필요시)

```bash
# UFW 방화벽에서 포트 8080 허용
sudo ufw allow 8080

# 방화벽 상태 확인
sudo ufw status
```

### 라우터 설정 (휴대폰 접근용)

1. **포트 포워딩 설정**:
   - 라우터 관리 페이지 접속
   - 포트 포워딩 규칙 추가
   - 외부 포트: 8080 → 내부 포트: 8080
   - 대상 IP: 라즈베리파이 IP

2. **고정 IP 설정** (권장):
   - 라우터에서 라즈베리파이에 고정 IP 할당
   - 또는 라즈베리파이에서 고정 IP 설정

## 📱 휴대폰 접근 방법

### 같은 WiFi 네트워크 내에서

1. 라즈베리파이 IP 주소 확인: `192.168.1.100` (예시)
2. 휴대폰 브라우저에서 접속: `http://192.168.1.100:8080`

### 외부 네트워크에서 (인터넷)

1. 라우터의 공인 IP 주소 확인
2. 포트 포워딩 설정 완료
3. 휴대폰 브라우저에서 접속: `http://[공인IP]:8080`

### 동적 DNS 사용 (권장)

```bash
# DuckDNS 설정 예시
# 1. DuckDNS 계정 생성 및 도메인 등록
# 2. 라즈베리파이에 DuckDNS 클라이언트 설치
sudo apt-get install curl
crontab -e

# 크론탭에 추가 (5분마다 IP 업데이트)
*/5 * * * * curl -s "https://www.duckdns.org/update?domains=yourdomain&token=your-token"
```

## 🔧 ESP32 설정

ESP32 코드에서 라즈베리파이 IP 주소를 설정하세요:

```cpp
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define SERVER_HOST   "192.168.1.100"  // 라즈베리파이 IP
#define SERVER_PORT   8080
```

## 📊 서버 모니터링

### 로그 확인

```bash
# 실시간 로그 확인
tail -f /var/log/syslog | grep node

# 또는 서버 실행 시 콘솔 출력 확인
```

### 서버 상태 확인

```bash
# 포트 8080 사용 확인
netstat -tlnp | grep :8080

# 프로세스 확인
ps aux | grep node
```

### 자동 시작 설정

```bash
# systemd 서비스 파일 생성
sudo nano /etc/systemd/system/sleep-alarm.service

# 서비스 파일 내용
[Unit]
Description=Smart Sleep Alarm Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/RaspberryPi_Server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target

# 서비스 활성화
sudo systemctl enable sleep-alarm.service
sudo systemctl start sleep-alarm.service
```

## 🔍 문제 해결

### 서버가 시작되지 않음

```bash
# 포트 충돌 확인
sudo lsof -i :8080

# Node.js 버전 확인
node --version

# 의존성 재설치
rm -rf node_modules package-lock.json
npm install
```

### ESP32 연결 안됨

1. 라즈베리파이와 ESP32가 같은 WiFi에 연결되어 있는지 확인
2. 라즈베리파이 IP 주소가 변경되지 않았는지 확인
3. 방화벽 설정 확인

### 휴대폰에서 접근 안됨

1. 라즈베리파이 IP 주소 재확인
2. 라우터 포트 포워딩 설정 확인
3. 휴대폰과 라즈베리파이가 같은 네트워크에 있는지 확인

## 📈 성능 최적화

### 메모리 사용량 최적화

```bash
# Node.js 메모리 제한 설정
node --max-old-space-size=512 server.js
```

### 자동 재시작 설정

```bash
# PM2 설치 및 사용
sudo npm install -g pm2

# 서버 실행
pm2 start server.js --name "sleep-alarm"

# 자동 시작 설정
pm2 startup
pm2 save
```

## 🔒 보안 설정

### HTTPS 설정 (선택사항)

```bash
# Let's Encrypt 인증서 설치
sudo apt-get install certbot

# 인증서 발급
sudo certbot certonly --standalone -d yourdomain.com

# HTTPS 서버 설정 (server.js 수정 필요)
```

### 방화벽 강화

```bash
# 기본 방화벽 설정
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 8080
sudo ufw enable
```

## 📞 지원

문제가 발생하면 다음을 확인하세요:

1. 라즈베리파이 시스템 로그: `sudo journalctl -f`
2. Node.js 애플리케이션 로그: 서버 실행 시 콘솔 출력
3. 네트워크 연결 상태: `ping google.com`
4. 포트 사용 상태: `netstat -tlnp | grep :8080`
