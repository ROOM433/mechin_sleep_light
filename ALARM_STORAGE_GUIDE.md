# ⏰ 알람 저장 및 불러오기 가이드

## 📍 현재 알람 저장 위치

### **메모리 저장 (임시)**
현재 알람 설정은 **서버 메모리(Map)**에만 저장됩니다:

```javascript
// server.js
let alarmSettings = new Map();    // 알람 설정
```

**특징:**
- ✅ 빠른 접근 속도
- ❌ 서버 재시작 시 모든 알람 설정이 사라짐
- ❌ 영구 저장되지 않음

---

## 🔍 알람 불러오기 방법

### **1. REST API로 조회**

#### 알람 설정 조회
```bash
GET /api/alarm/:deviceId
```

**예시:**
```bash
# 브라우저에서
http://localhost:8080/api/alarm/ESP32_001

# curl 명령어
curl http://localhost:8080/api/alarm/ESP32_001
```

**응답 예시:**
```json
{
  "targetWakeTime": 1704067200000,
  "optimalWakeTime": 1704061800000,
  "recommendedTime": 1704060900000,
  "setAt": 1704060000000
}
```

### **2. 웹 인터페이스에서 조회**

웹 페이지에서 알람 설정을 조회하는 기능은 현재 구현되어 있지 않습니다. 
알람은 설정만 가능하고, 조회는 API를 직접 호출해야 합니다.

---

## 💾 알람 저장 구조

### **저장되는 데이터:**
```javascript
{
  targetWakeTime: Number,      // 목표 기상 시간 (타임스탬프)
  optimalWakeTime: Number,     // 최적 알람 시간 (90분 사이클 기반)
  recommendedTime: Number,     // 권장 알람 시간
  setAt: Number                // 설정한 시간 (타임스탬프)
}
```

### **저장 위치:**
- **서버 메모리:** `alarmSettings` Map 객체
- **키(Key):** 디바이스 ID (예: "ESP32_001")
- **값(Value):** 알람 설정 객체

---

## ⚠️ 현재 제한사항

1. **영구 저장 안됨:** 서버 재시작 시 알람 설정이 사라짐
2. **파일 저장 안됨:** 디스크에 저장되지 않음
3. **데이터베이스 없음:** DB에 저장되지 않음

---

## 🔧 영구 저장 기능 추가 (선택사항)

영구 저장이 필요하다면 다음 방법을 사용할 수 있습니다:

### **방법 1: JSON 파일로 저장**
```javascript
// 알람 설정을 JSON 파일로 저장
const fs = require('fs');
const ALARM_FILE = './alarms.json';

// 저장
fs.writeFileSync(ALARM_FILE, JSON.stringify([...alarmSettings]));

// 불러오기
const saved = JSON.parse(fs.readFileSync(ALARM_FILE, 'utf8'));
alarmSettings = new Map(saved);
```

### **방법 2: 데이터베이스 사용**
- SQLite (간단한 파일 DB)
- MongoDB
- MySQL/PostgreSQL

---

## 📝 알람 설정 API 사용법

### **알람 설정하기**
```bash
POST /api/alarm/set
Content-Type: application/json

{
  "deviceId": "ESP32_001",
  "targetWakeTime": 1704067200000
}
```

### **알람 조회하기**
```bash
GET /api/alarm/ESP32_001
```

### **응답 예시**
```json
{
  "targetWakeTime": 1704067200000,
  "optimalWakeTime": 1704061800000,
  "recommendedTime": 1704060900000,
  "setAt": 1704060000000
}
```

---

## 🎯 요약

| 항목 | 내용 |
|------|------|
| **저장 위치** | 서버 메모리 (Map 객체) |
| **저장 형식** | JavaScript Map |
| **영구 저장** | ❌ 없음 (서버 재시작 시 사라짐) |
| **조회 방법** | `GET /api/alarm/:deviceId` |
| **설정 방법** | `POST /api/alarm/set` |
| **웹 UI 조회** | ❌ 없음 (API 직접 호출 필요) |

---

## 💡 권장사항

1. **개발/테스트:** 현재 메모리 저장으로 충분
2. **프로덕션:** JSON 파일 또는 데이터베이스로 영구 저장 추가 권장


