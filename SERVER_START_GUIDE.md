# 🚀 서버 실행 가이드

## Windows에서 실행

### 방법 1: 배치 파일 사용 (가장 간단)
```bash
start.bat
```

### 방법 2: npm 명령어 사용
```bash
npm install    # 최초 1회만 (의존성 설치)
npm start      # 서버 시작
```

### 방법 3: Node.js 직접 실행
```bash
node server.js
```

---

## Linux/Mac에서 실행

### 방법 1: 셸 스크립트 사용
```bash
chmod +x start.sh    # 최초 1회만 (실행 권한 부여)
./start.sh
```

### 방법 2: npm 명령어 사용
```bash
npm install    # 최초 1회만 (의존성 설치)
npm start      # 서버 시작
```

### 방법 3: Node.js 직접 실행
```bash
node server.js
```

---

## 서버 접속

서버가 시작되면 다음 주소로 접속:
- **로컬:** http://localhost:8080
- **네트워크:** http://[서버IP]:8080

---

## 서버 종료

터미널에서 `Ctrl + C`를 누르면 서버가 종료됩니다.

---

## 문제 해결

### Node.js가 설치되지 않은 경우
1. https://nodejs.org 에서 Node.js 다운로드 및 설치
2. 설치 후 터미널 재시작

### 포트 8080이 이미 사용 중인 경우
`server.js` 파일에서 포트 번호를 변경:
```javascript
const PORT = process.env.PORT || 8080;  // 다른 포트로 변경 (예: 3000)
```

### 의존성 설치 오류
```bash
npm cache clean --force
npm install
```

