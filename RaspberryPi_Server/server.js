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
app.use(express.static(path.join(__dirname, 'public')));

// 전역 변수
let connectedDevices = new Map(); // 연결된 ESP32 디바이스들
let sleepSessions = new Map();    // 수면 세션 데이터
let alarmSettings = new Map();    // 알람 설정

/**
 * 수면 패턴 분석 클래스
 */
class SleepAnalyzer {
    constructor() {
        this.sleepCycles = []; // 수면 사이클 데이터
        this.currentCycle = 0;
        this.cycleDuration = 90 * 60 * 1000; // 90분 (밀리초)
    }

    /**
     * 수면 데이터를 분석하여 수면 단계를 판단
     */
    analyzeSleepData(sleepData) {
        const analysis = {
            timestamp: Date.now(),
            sleepStage: this.determineSleepStage(sleepData),
            movementLevel: this.calculateMovementLevel(sleepData),
            cyclePosition: this.getCyclePosition()
        };

        this.updateSleepCycle(analysis);
        return analysis;
    }

    /**
     * 수면 단계 판단 (움직임과 시간 기반)
     */
    determineSleepStage(data) {
        const avgMovement = data.reduce((sum, d) => sum + d.movement_score, 0) / data.length;
        
        if (avgMovement < 0.1) {
            return 2; // 깊은잠
        } else if (avgMovement < 0.3) {
            return 1; // 얕은잠
        } else {
            return 0; // 깨어있음
        }
    }

    /**
     * 움직임 레벨 계산
     */
    calculateMovementLevel(data) {
        return data.reduce((sum, d) => sum + d.movement_score, 0) / data.length;
    }

    /**
     * 현재 수면 사이클 위치 계산
     */
    getCyclePosition() {
        return (Date.now() % this.cycleDuration) / this.cycleDuration;
    }

    /**
     * 수면 사이클 업데이트
     */
    updateSleepCycle(analysis) {
        this.sleepCycles.push(analysis);
        
        // 최근 8시간 데이터만 유지
        const eightHoursAgo = Date.now() - (8 * 60 * 60 * 1000);
        this.sleepCycles = this.sleepCycles.filter(cycle => cycle.timestamp > eightHoursAgo);
    }

    /**
     * 최적의 알람 시간 계산 (90분 사이클 기반)
     */
    calculateOptimalAlarmTime(targetWakeTime) {
        const now = Date.now();
        const timeToTarget = targetWakeTime - now;
        
        // 90분 사이클로 나누어 최적의 시간 계산
        const cyclesToTarget = Math.floor(timeToTarget / this.cycleDuration);
        const optimalTime = targetWakeTime - (cyclesToTarget * this.cycleDuration);
        
        // 얕은잠 단계에서 깨우기 위해 약간의 여유 시간 추가
        const shallowSleepWindow = 15 * 60 * 1000; // 15분
        
        return {
            optimalWakeTime: optimalTime,
            cyclesToTarget: cyclesToTarget,
            shallowSleepWindow: shallowSleepWindow,
            recommendedTime: Math.max(optimalTime - shallowSleepWindow, now + (30 * 60 * 1000)) // 최소 30분 후
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
 * 알람 발생 처리
 */
function handleAlarmTriggered(deviceId, data) {
    console.log(`디바이스 ${deviceId} 알람 발생!`);
    
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
    const { targetWakeTime, deviceId } = req.body;
    
    if (!targetWakeTime || !deviceId) {
        return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }
    
    // 최적의 알람 시간 계산
    const alarmCalculation = sleepAnalyzer.calculateOptimalAlarmTime(targetWakeTime);
    
    // 알람 설정 저장
    alarmSettings.set(deviceId, {
        targetWakeTime: targetWakeTime,
        optimalWakeTime: alarmCalculation.optimalWakeTime,
        recommendedTime: alarmCalculation.recommendedTime,
        setAt: Date.now()
    });
    
    // ESP32 디바이스에 알람 설정 전송
    const device = connectedDevices.get(deviceId);
    if (device && device.ws.readyState === WebSocket.OPEN) {
        const alarmCommand = {
            command: 'set_alarm',
            alarm_time: alarmCalculation.recommendedTime,
            target_wake_time: targetWakeTime
        };
        
        device.ws.send(JSON.stringify(alarmCommand));
    }
    
    res.json({
        success: true,
        alarmCalculation: alarmCalculation,
        message: '알람이 설정되었습니다.'
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

// 조명 밝기 설정 API (디밍)
app.post('/api/light/brightness', (req, res) => {
    const { deviceId, level } = req.body;
    if (deviceId == null || level == null) {
        return res.status(400).json({ error: 'deviceId와 level이 필요합니다.' });
    }
    const device = connectedDevices.get(deviceId);
    if (!device || device.ws.readyState !== WebSocket.OPEN) {
        return res.status(404).json({ error: '디바이스가 연결되어 있지 않습니다.' });
    }
    const command = { command: 'set_brightness', level: Math.max(0, Math.min(100, Number(level))) };
    device.ws.send(JSON.stringify(command));
    res.json({ success: true, message: '밝기 명령을 전송했습니다.', command });
});

// 선라이즈(일출 효과) 시작 API
app.post('/api/light/sunrise', (req, res) => {
    const { deviceId, duration_ms, target_level } = req.body;
    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId가 필요합니다.' });
    }
    const device = connectedDevices.get(deviceId);
    if (!device || device.ws.readyState !== WebSocket.OPEN) {
        return res.status(404).json({ error: '디바이스가 연결되어 있지 않습니다.' });
    }
    const command = {
        command: 'sunrise_start',
        duration_ms: Number(duration_ms || (15 * 60 * 1000)),
        target_level: Math.max(0, Math.min(100, Number(target_level || 100)))
    };
    device.ws.send(JSON.stringify(command));
    res.json({ success: true, message: '선라이즈를 시작했습니다.', command });
});

// 선라이즈 취소 API
app.post('/api/light/sunrise/cancel', (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId가 필요합니다.' });
    }
    const device = connectedDevices.get(deviceId);
    if (!device || device.ws.readyState !== WebSocket.OPEN) {
        return res.status(404).json({ error: '디바이스가 연결되어 있지 않습니다.' });
    }
    const command = { command: 'sunrise_cancel' };
    device.ws.send(JSON.stringify(command));
    res.json({ success: true, message: '선라이즈를 취소했습니다.' });
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

// 메인 페이지 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0'; // 모든 네트워크 인터페이스에서 접근 가능

server.listen(PORT, HOST, () => {
    console.log(`🚀 스마트 수면 알람 서버가 실행 중입니다!`);
    console.log(`📱 로컬 접속: http://localhost:${PORT}`);
    console.log(`🌐 네트워크 접속: http://[라즈베리파이IP]:${PORT}`);
    console.log(`📊 서버 상태: 활성`);
});

// 정리 작업
process.on('SIGINT', () => {
    console.log('서버를 종료합니다...');
    server.close(() => {
        console.log('서버가 종료되었습니다.');
        process.exit(0);
    });
});
