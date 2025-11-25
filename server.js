const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 정적 파일 서빙 최적화 (캐싱 및 압축)
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',  // 1일간 캐싱
    etag: true,    // ETag 활성화
    lastModified: true  // Last-Modified 헤더 활성화
}));

// 전역 변수
let connectedDevices = new Map(); // 연결된 ESP32 디바이스들
let sleepSessions = new Map();    // 수면 세션 데이터
let alarmSettings = new Map();    // 알람 설정

/**
 * 수면 패턴 분석 클래스
 */
class SleepAnalyzer {
    constructor() {
        this.sleepCycles = [];
        this.currentCycle = 0;
        this.cycleDuration = 90 * 60 * 1000; // 90분
    }

    // targetWakeTime: Date.getTime() (ms)
    calculateOptimalAlarmTime(targetWakeTime, baseTime) {
        const cycle = this.cycleDuration;
        const start = baseTime || Date.now();

        if (targetWakeTime <= start) {
            return {
                optimalWakeTime: targetWakeTime,
                cyclesToTarget: 0,
                recommendedTime: targetWakeTime
            };
        }

        const firstCycle = start + cycle;

        if (firstCycle > targetWakeTime) {
            return {
                optimalWakeTime: targetWakeTime,
                cyclesToTarget: 0,
                recommendedTime: targetWakeTime
            };
        }

        const diff = targetWakeTime - firstCycle;
        const extraCycles = Math.floor(diff / cycle);
        const optimal = firstCycle + extraCycles * cycle;

        return {
            optimalWakeTime: optimal,
            cyclesToTarget: extraCycles + 1,
            recommendedTime: optimal
        };
    }

    /**
     * ESP32에서 받은 sleep_data 배열을 프론트가 기대하는 형태로 요약
     * dataArray: [{ sleep_stage, movement_score, timestamp, ... }, ...]
     */
    analyzeSleepData(dataArray) {
        // 데이터가 없으면 기본값 반환 (프론트에서 에러 안 나도록)
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
            return {
                sleepStage: 0,
                movementLevel: 0,
                cyclePosition: 0,
                stageCounts: { awake: 0, light: 0, deep: 0 },
                avgMovement: 0
            };
        }

        const last = dataArray[dataArray.length - 1];

        // 최신 샘플 기준 "현재 수면 단계"와 "현재 움직임"
        const sleepStage = (typeof last.sleep_stage === 'number') ? last.sleep_stage : 0;
        const movementLevel = (typeof last.movement_score === 'number') ? last.movement_score : 0;

        // 통계용 집계 (원하면 화면에 따로 쓰거나 로그로 사용)
        let stageCountsRaw = { 0: 0, 1: 0, 2: 0 };
        let totalMovement = 0;

        for (const d of dataArray) {
            const st = (typeof d.sleep_stage === 'number') ? d.sleep_stage : 0;
            const mv = (typeof d.movement_score === 'number') ? d.movement_score : 0;

            totalMovement += mv;
            if (stageCountsRaw[st] !== undefined) {
                stageCountsRaw[st]++;
            }
        }

        // 간단한 "수면 사이클 위치" 계산 (이 배열 안에서 경과된 시간 기준)
        let cyclePosition = 0;
        const firstTs = dataArray[0].timestamp;
        const lastTs = last.timestamp;
        if (typeof firstTs === 'number' && typeof lastTs === 'number') {
            const elapsed = Math.max(0, lastTs - firstTs); // ms
            if (elapsed > 0) {
                cyclePosition = (elapsed % this.cycleDuration) / this.cycleDuration; // 0~1
            }
        }

        return {
            // 프론트가 직접 쓰는 값들
            sleepStage,          // 0,1,2
            movementLevel,       // 움직임 레벨 (그대로 movement_score 사용)
            cyclePosition,       // 0.0~1.0

            // 참고용 통계
            stageCounts: {
                awake: stageCountsRaw[0],
                light: stageCountsRaw[1],
                deep: stageCountsRaw[2]
            },
            avgMovement: totalMovement / dataArray.length
        };
    }
}


// 수면 분석기 인스턴스
const sleepAnalyzer = new SleepAnalyzer();

/**
 * WebSocket 연결 처리
 */
wss.on('connection', (ws, req) => {
    console.log('새로운 WebSocket 연결');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleWebSocketMessage(ws, data);
        } catch (error) {
            console.error('WebSocket 메시지 파싱 오류:', error);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket 연결 종료');
        // 연결된 디바이스에서 제거
        for (let [deviceId, device] of connectedDevices) {
            if (device.ws === ws) {
                connectedDevices.delete(deviceId);
                console.log(`디바이스 ${deviceId} 연결 해제`);
                break;
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket 오류:', error);
    });
});

/**
 * WebSocket 메시지 처리
 */
function handleWebSocketMessage(ws, data) {
    const { device_id, data_type, status, timestamp } = data;

    switch (data_type) {
        case 'sleep_data':
            handleSleepData(device_id, data);
            break;

        case 'device_status':
            handleDeviceStatus(ws, device_id, data);
            break;

        default:
            console.log('알 수 없는 데이터 타입:', data_type);
    }

    // 상태별 처리
    if (status) {
        switch (status) {
            case 'connected':
                handleDeviceConnection(ws, device_id, data);
                break;
            case 'monitoring_started':
                handleMonitoringStarted(device_id, data);
                break;
            case 'monitoring_stopped':
                handleMonitoringStopped(device_id, data);
                break;
            case 'sleep_detected':
                handleSleepDetected(device_id, data);
                break;
            case 'alarm_triggered':
                handleAlarmTriggered(device_id, data);
                break;
        }
    }
}

/**
 * 디바이스 연결 처리
 */
function handleDeviceConnection(ws, deviceId, data) {
    connectedDevices.set(deviceId, {
        ws: ws,
        deviceId: deviceId,
        connectedAt: Date.now(),
        isMonitoring: data.monitoring || false,
        alarmActive: data.alarm_active || false
    });

    console.log(`디바이스 ${deviceId} 연결됨`);

    // 클라이언트들에게 디바이스 상태 업데이트 전송
    broadcastDeviceStatus();
}

/**
 * 수면 데이터 처리
 */
function handleSleepData(deviceId, data) {
    if (!sleepSessions.has(deviceId)) {
        sleepSessions.set(deviceId, {
            deviceId: deviceId,
            startTime: Date.now(),
            data: []
        });
    }

    const session = sleepSessions.get(deviceId);
    session.data.push(...data.data);

    // 수면 패턴 분석
    const analysis = sleepAnalyzer.analyzeSleepData(data.data);
    session.lastAnalysis = analysis;

    console.log(`디바이스 ${deviceId} 수면 데이터 수신:`, analysis);

    // 웹 클라이언트들에게 실시간 데이터 전송
    broadcastSleepData(deviceId, analysis);
}

/**
 * 모니터링 시작 처리
 */
function handleMonitoringStarted(deviceId, data) {
    const device = connectedDevices.get(deviceId);
    if (device) {
        device.isMonitoring = true;
    }

    // 새로운 수면 세션 시작
    sleepSessions.set(deviceId, {
        deviceId: deviceId,
        startTime: Date.now(),
        data: []
    });

    console.log(`디바이스 ${deviceId} 수면 모니터링 시작`);
    broadcastDeviceStatus();
}

/**
 * 모니터링 중지 처리
 */
function handleMonitoringStopped(deviceId, data) {
    const device = connectedDevices.get(deviceId);
    if (device) {
        device.isMonitoring = false;
    }

    console.log(`디바이스 ${deviceId} 수면 모니터링 중지`);
    broadcastDeviceStatus();
}

/**
 * 수면 감지 처리 (1분 이상 움직임 없음)
 */

function handleSleepDetected(deviceId, data) {
    console.log(`디바이스 ${deviceId} 수면 감지됨`);

    const device = connectedDevices.get(deviceId);
    if (!device) return;

    // 알람 설정 확인
    const alarmSetting = alarmSettings.get(deviceId);
    if (!alarmSetting) {
        console.log(`디바이스 ${deviceId}에 알람 설정이 없습니다.`);
        return;
    }

    // 수면 시작 시각: 서버가 메시지 받은 시각 기준으로 사용 (ESP32 millis()는 사용 X)
    const sleepStartTime = Date.now();
    const targetWakeTime = alarmSetting.targetWakeTime;

    // 90분 사이클 기반 최적 알람 시간 계산 (기준 = sleepStartTime)
    const alarmCalculation = sleepAnalyzer.calculateOptimalAlarmTime(targetWakeTime, sleepStartTime);
    const recommendedTime = alarmCalculation.recommendedTime;

    const now = Date.now();
    let delayMs = recommendedTime - now;
    if (delayMs < 1000) delayMs = 1000; // 최소 1초 뒤 (지연이 너무 짧으면 보정)

    console.log('--- Sleep detected alarm calc ---');
    console.log('targetWakeTime:', targetWakeTime, '->', new Date(targetWakeTime).toLocaleString());
    console.log('sleepStartTime:', sleepStartTime, '->', new Date(sleepStartTime).toLocaleString());
    console.log('recommendedTime:', recommendedTime, '->', new Date(recommendedTime).toLocaleString());
    console.log('delayMs:', delayMs, 'ms');

    // ESP32에 알람 delay 전송
    if (device.ws.readyState === WebSocket.OPEN) {
        const alarmCommand = {
            command: 'set_alarm',
            delay_ms: delayMs
        };

        device.ws.send(JSON.stringify(alarmCommand));
        console.log(`[ESP32] set_alarm (delay_ms=${delayMs}) 전송 완료`);
    }

    // 알람 설정 업데이트
    alarmSettings.set(deviceId, {
        ...alarmSetting,
        sleepDetected: true,
        sleepStartTime: sleepStartTime,
        optimalWakeTime: alarmCalculation.optimalWakeTime,
        recommendedTime: recommendedTime,
        sleepDetectedAt: now
    });

    // 웹 클라이언트 알림
    broadcastSleepDetected(deviceId, {
        sleepStartTime: sleepStartTime,
        recommendedAlarmTime: recommendedTime,
        cyclesToTarget: alarmCalculation.cyclesToTarget
    });
}


/**
 * 알람 발생 처리
 */
function handleAlarmTriggered(deviceId, data) {
    console.log(`디바이스 ${deviceId} 알람 발생!`);

    const device = connectedDevices.get(deviceId);
    const alarmSetting = alarmSettings.get(deviceId);

    // 알람용 패턴·밝기 설정이 있다면, 디밍 패턴 시작
    if (device && device.ws.readyState === WebSocket.OPEN && alarmSetting) {
        const dimmerCommand = {
            command: 'bulb_dimming',
            pattern: alarmSetting.pattern || 1,
            maxBright: alarmSetting.maxBright || 100,
            interval_ms: alarmSetting.intervalMs || 10
        };

        device.ws.send(JSON.stringify(dimmerCommand));
        console.log(`[ESP32] alarm dimming start: pattern=${dimmerCommand.pattern}, maxBright=${dimmerCommand.maxBright}`);
    }

    // 웹 클라이언트들에게 알람 발생 알림
    broadcastAlarmTriggered(deviceId);
}

/**
 * 디바이스 상태 브로드캐스트
 */
function broadcastDeviceStatus() {
    const status = {
        type: 'device_status',
        devices: Array.from(connectedDevices.values()).map(device => ({
            deviceId: device.deviceId,
            isMonitoring: device.isMonitoring,
            alarmActive: device.alarmActive,
            connectedAt: device.connectedAt
        }))
    };

    broadcastToWebClients(status);
}

/**
 * 수면 데이터 브로드캐스트
 */
function broadcastSleepData(deviceId, analysis) {
    const data = {
        type: 'sleep_data',
        deviceId: deviceId,
        analysis: analysis,
        timestamp: Date.now()
    };

    broadcastToWebClients(data);
}

/**
 * 수면 감지 브로드캐스트
 */
function broadcastSleepDetected(deviceId, sleepInfo) {
    const data = {
        type: 'sleep_detected',
        deviceId: deviceId,
        sleepInfo: sleepInfo,
        timestamp: Date.now()
    };

    broadcastToWebClients(data);
}

/**
 * 알람 발생 브로드캐스트
 */
function broadcastAlarmTriggered(deviceId) {
    const data = {
        type: 'alarm_triggered',
        deviceId: deviceId,
        timestamp: Date.now()
    };

    broadcastToWebClients(data);
}

/**
 * 웹 클라이언트들에게 메시지 브로드캐스트
 */
function broadcastToWebClients(message) {
    const messageStr = JSON.stringify(message);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            // ESP32 디바이스가 아닌 웹 클라이언트들에게만 전송
            const isWebClient = !Array.from(connectedDevices.values()).some(device => device.ws === client);
            if (isWebClient) {
                client.send(messageStr);
            }
        }
    });
}

/**
 * API 라우트들
 */


// 알람 설정 API
app.post('/api/alarm/set', (req, res) => {
    let { targetWakeTime, deviceId, pattern, maxBright, intervalMs } = req.body; // ⬅️ intervalMs 추가

    if (!targetWakeTime || !deviceId) {
        return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }

    const wakeDate = new Date(targetWakeTime);
    const wakeTs = wakeDate.getTime();

    if (isNaN(wakeTs)) {
        return res.status(400).json({ error: '잘못된 날짜 형식입니다.' });
    }

    const now = Date.now();

    const alarmPattern = parseInt(pattern) || 1;
    const alarmMaxBright = parseInt(maxBright) || 100;

    // 🔴 디밍 속도 최소 200ms, 기본값 4000ms
    let alarmIntervalMs = parseInt(intervalMs, 10);
    if (Number.isNaN(alarmIntervalMs) || alarmIntervalMs < 200) {
        alarmIntervalMs = 4000;
    }

    alarmSettings.set(deviceId, {
        targetWakeTime: wakeTs,
        optimalWakeTime: null,
        recommendedTime: null,
        setAt: now,
        sleepDetected: false,
        pattern: alarmPattern,
        maxBright: alarmMaxBright,
        intervalMs: alarmIntervalMs // ⬅️ 저장
    });

    const device = connectedDevices.get(deviceId);
    if (device && device.ws.readyState === WebSocket.OPEN) {
        const startCommand = {
            command: 'start_monitoring',
            timestamp: now
        };
        device.ws.send(JSON.stringify(startCommand));
    }

    console.log('=== Alarm set ===');
    console.log('raw targetWakeTime:', wakeTs, '->', new Date(wakeTs).toLocaleString());
    console.log('pattern:', alarmPattern, 'maxBright:', alarmMaxBright, 'intervalMs:', alarmIntervalMs);

    res.json({
        success: true,
        message: '알람이 설정되었고 수면 모니터링을 시작했습니다.',
        targetWakeTime: wakeTs,
        pattern: alarmPattern,
        maxBright: alarmMaxBright,
        intervalMs: alarmIntervalMs
    });
});




// 수면 모니터링 시작 API
app.post('/api/sleep/start', (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: '디바이스 ID가 필요합니다.' });
    }

    const device = connectedDevices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: '디바이스를 찾을 수 없습니다.' });
    }

    // ESP32에 모니터링 시작 명령 전송
    const command = {
        command: 'start_monitoring',
        timestamp: Date.now()
    };

    device.ws.send(JSON.stringify(command));

    res.json({
        success: true,
        message: '수면 모니터링이 시작되었습니다.'
    });
});

// 수면 모니터링 중지 API
app.post('/api/sleep/stop', (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: '디바이스 ID가 필요합니다.' });
    }

    const device = connectedDevices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: '디바이스를 찾을 수 없습니다.' });
    }

    // ESP32에 모니터링 중지 명령 전송
    const command = {
        command: 'stop_monitoring',
        timestamp: Date.now()
    };

    device.ws.send(JSON.stringify(command));

    res.json({
        success: true,
        message: '수면 모니터링이 중지되었습니다.'
    });
});

// 디바이스 상태 조회 API
app.get('/api/devices', (req, res) => {
    const devices = Array.from(connectedDevices.values()).map(device => ({
        deviceId: device.deviceId,
        isMonitoring: device.isMonitoring,
        alarmActive: device.alarmActive,
        connectedAt: device.connectedAt
    }));

    res.json({ devices });
});

// 수면 세션 데이터 조회 API
app.get('/api/sleep/session/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const session = sleepSessions.get(deviceId);

    if (!session) {
        return res.status(404).json({ error: '수면 세션을 찾을 수 없습니다.' });
    }

    res.json(session);
});

// 알람 설정 조회 API
app.get('/api/alarm/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const alarmSetting = alarmSettings.get(deviceId);

    if (!alarmSetting) {
        return res.status(404).json({ error: '알람 설정을 찾을 수 없습니다.' });
    }

    res.json(alarmSetting);
});

// 알람 취소 API
app.post('/api/alarm/cancel', (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: '디바이스 ID가 필요합니다.' });
    }

    const device = connectedDevices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: '디바이스를 찾을 수 없습니다.' });
    }

    // ESP32에 알람 취소 명령 전송
    if (device.ws.readyState === WebSocket.OPEN) {
        const command = {
            command: 'cancel_alarm',
            timestamp: Date.now()
        };

        device.ws.send(JSON.stringify(command));
    }

    // 알람 설정 제거
    alarmSettings.delete(deviceId);

    res.json({
        success: true,
        message: '알람이 취소되었습니다.'
    });
});

// 디밍 제어 API들

// 전구 전원 켜/끄기
app.post('/api/dimmer/power', (req, res) => {
    const { deviceId, on } = req.body;

    if (deviceId === undefined || on === undefined) {
        return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }

    const device = connectedDevices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: '디바이스를 찾을 수 없습니다.' });
    }

    if (device.ws.readyState === WebSocket.OPEN) {
        const command = {
            command: 'bulb_power',
            on: on
        };

        device.ws.send(JSON.stringify(command));
        res.json({ success: true, message: `전구 전원: ${on ? 'ON' : 'OFF'}` });
    } else {
        res.status(503).json({ error: '디바이스가 연결되어 있지 않습니다.' });
    }
});

// 디밍 패턴 시작
app.post('/api/dimmer/pattern', (req, res) => {
    const { deviceId, pattern, maxBright, intervalMs } = req.body;

    if (!deviceId || !pattern) {
        return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }

    const device = connectedDevices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: '디바이스를 찾을 수 없습니다.' });
    }

    if (device.ws.readyState === WebSocket.OPEN) {
        const command = {
            command: 'bulb_dimming',
            pattern: pattern,
            maxBright: maxBright || 100
        };

        // 👉 클라이언트에서 보낸 값이 있으면 같이 전달
        if (typeof intervalMs === 'number' && !Number.isNaN(intervalMs) && intervalMs > 0) {
            command.interval_ms = intervalMs;
        }

        device.ws.send(JSON.stringify(command));
        res.json({ success: true, message: `디밍 패턴 ${pattern} 시작` });
    }
    else {
        res.status(503).json({ error: '디바이스가 연결되어 있지 않습니다.' });
    }
});

// 밝기 고정 설정
app.post('/api/dimmer/brightness', (req, res) => {
    const { deviceId, level } = req.body;

    if (!deviceId || level === undefined) {
        return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }

    const device = connectedDevices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: '디바이스를 찾을 수 없습니다.' });
    }

    if (device.ws.readyState === WebSocket.OPEN) {
        const command = {
            command: 'set_power_clamped',
            level: level
        };

        device.ws.send(JSON.stringify(command));
        res.json({ success: true, message: `밝기 설정: ${level}%` });
    } else {
        res.status(503).json({ error: '디바이스가 연결되어 있지 않습니다.' });
    }
});

// 메인 페이지 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`웹 인터페이스: http://localhost:${PORT}`);
});

