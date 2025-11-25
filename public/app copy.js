// 스마트 수면 알람 시스템 클라이언트 JavaScript

class SleepAlarmApp {
    constructor() {
        this.ws = null;
        this.devices = new Map();
        this.currentDeviceId = null;
        this.isMonitoring = false;
        this.sleepChart = null;
        this.chartData = {
            labels: [],
            datasets: [{
                label: '수면 단계',
                data: [],
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1
            }, {
                label: '움직임 레벨',
                data: [],
                borderColor: 'rgb(255, 99, 132)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                tension: 0.1,
                yAxisID: 'y1'
            }]
        };
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initChart();
        this.connectWebSocket();
        this.loadDevices();
    }

    setupEventListeners() {
        // 알람 설정 버튼
        document.getElementById('setAlarmBtn').addEventListener('click', () => {
            this.setAlarm();
        });

        // 알람 취소 버튼
        document.getElementById('cancelAlarmBtn').addEventListener('click', () => {
            this.cancelAlarm();
        });

        // 모니터링 시작 버튼
        document.getElementById('startMonitoringBtn').addEventListener('click', () => {
            this.startMonitoring();
        });

        // 모니터링 중지 버튼
        document.getElementById('stopMonitoringBtn').addEventListener('click', () => {
            this.stopMonitoring();
        });

        // 기상 시간 입력 시 자동으로 최적 시간 계산
        document.getElementById('wakeTime').addEventListener('change', () => {
            this.calculateOptimalWakeTime();
        });

        // 디밍 제어 이벤트 리스너
        document.getElementById('bulbOnBtn').addEventListener('click', () => {
            this.bulbPower(true);
        });

        document.getElementById('bulbOffBtn').addEventListener('click', () => {
            this.bulbPower(false);
        });

        document.getElementById('startPatternBtn').addEventListener('click', () => {
            this.startDimmingPattern();
        });

        document.getElementById('setBrightnessBtn').addEventListener('click', () => {
            this.setBrightness();
        });

        // 밝기 슬라이더 값 표시
        document.getElementById('brightnessSlider').addEventListener('input', (e) => {
            document.getElementById('brightnessValue').textContent = e.target.value;
        });
    }

    initChart() {
        const ctx = document.getElementById('sleepChart').getContext('2d');
        this.sleepChart = new Chart(ctx, {
            type: 'line',
            data: this.chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        min: 0,
                        max: 2,
                        ticks: {
                            callback: function(value) {
                                const stages = ['깨어있음', '얕은잠', '깊은잠'];
                                return stages[value] || value;
                            }
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        min: 0,
                        max: 1,
                        grid: {
                            drawOnChartArea: false,
                        },
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (context.datasetIndex === 0) {
                                    const stages = ['깨어있음', '얕은잠', '깊은잠'];
                                    return `수면 단계: ${stages[context.parsed.y] || context.parsed.y}`;
                                } else {
                                    return `움직임 레벨: ${context.parsed.y.toFixed(3)}`;
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.updateConnectionStatus(true);
            this.addLog('WebSocket 연결됨', 'success');
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('WebSocket 메시지 파싱 오류:', error);
            }
        };

        this.ws.onclose = () => {
            this.updateConnectionStatus(false);
            this.addLog('WebSocket 연결 끊어짐', 'warning');
            
            // 5초 후 재연결 시도
            setTimeout(() => {
                this.connectWebSocket();
            }, 5000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket 오류:', error);
            this.addLog('WebSocket 오류 발생', 'danger');
        };
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'device_status':
                this.updateDeviceStatus(data.devices);
                break;
            case 'sleep_data':
                this.updateSleepData(data);
                break;
            case 'sleep_detected':
                this.handleSleepDetected(data);
                break;
            case 'alarm_triggered':
                this.handleAlarmTriggered(data);
                break;
        }
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connectionStatus');
        const icon = statusElement.querySelector('i');
        
        if (connected) {
            icon.className = 'fas fa-circle text-success';
            statusElement.innerHTML = '<i class="fas fa-circle text-success"></i> 연결됨';
        } else {
            icon.className = 'fas fa-circle text-danger';
            statusElement.innerHTML = '<i class="fas fa-circle text-danger"></i> 연결 중...';
        }
    }

    updateDeviceStatus(devices) {
        const container = document.getElementById('deviceStatus');
        
        if (devices.length === 0) {
            container.innerHTML = '<p class="text-muted">연결된 디바이스가 없습니다.</p>';
            this.updateButtonStates(false);
            return;
        }

        let html = '';
        devices.forEach(device => {
            this.devices.set(device.deviceId, device);
            
            if (!this.currentDeviceId) {
                this.currentDeviceId = device.deviceId;
            }

            const statusClasses = [];
            if (device.isMonitoring) statusClasses.push('monitoring');
            if (device.alarmActive) statusClasses.push('alarm-active');
            
            html += `
                <div class="device-status-item">
                    <div>
                        <div class="device-name">${device.deviceId}</div>
                        <small class="text-muted">연결됨: ${new Date(device.connectedAt).toLocaleTimeString()}</small>
                    </div>
                    <div>
                        <span class="device-status connected">연결됨</span>
                        ${device.isMonitoring ? '<span class="device-status monitoring">모니터링 중</span>' : ''}
                        ${device.alarmActive ? '<span class="device-status alarm-active">알람 활성</span>' : ''}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        this.updateButtonStates(true);
    }

    updateButtonStates(deviceAvailable) {
        const buttons = [
            'setAlarmBtn',
            'startMonitoringBtn',
            'stopMonitoringBtn',
            'cancelAlarmBtn',
            'bulbOnBtn',
            'bulbOffBtn',
            'startPatternBtn',
            'setBrightnessBtn'
        ];

        buttons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) button.disabled = !deviceAvailable;
        });

        // 디밍 제어 입력 필드 활성화/비활성화
        const dimmerInputs = [
            'patternSelect',
            'maxBrightInput',
            'brightnessSlider'
        ];

        dimmerInputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) input.disabled = !deviceAvailable;
        });
    }

    updateSleepData(data) {
        if (data.deviceId !== this.currentDeviceId) return;

        const analysis = data.analysis;
        
        // 차트 데이터 업데이트
        const now = new Date().toLocaleTimeString();
        this.chartData.labels.push(now);
        this.chartData.datasets[0].data.push(analysis.sleepStage);
        this.chartData.datasets[1].data.push(analysis.movementLevel);

        // 최근 20개 데이터만 유지
        if (this.chartData.labels.length > 20) {
            this.chartData.labels.shift();
            this.chartData.datasets[0].data.shift();
            this.chartData.datasets[1].data.shift();
        }

        this.sleepChart.update();

        // 수면 정보 업데이트
        this.updateSleepInfo(analysis);
        
        // 모니터링 상태 업데이트
        document.getElementById('monitoringStatus').textContent = '모니터링 중';
        document.getElementById('monitoringStatus').className = 'text-success';
    }

    updateSleepInfo(analysis) {
        const stages = ['깨어있음', '얕은잠', '깊은잠'];
        const stageColors = ['#dc3545', '#ffc107', '#198754'];
        
        // 수면 단계 업데이트
        const stageBar = document.getElementById('sleepStageBar');
        const stageText = document.getElementById('sleepStageText');
        stageBar.style.width = `${(analysis.sleepStage / 2) * 100}%`;
        stageBar.className = `progress-bar sleep-stage-${analysis.sleepStage}`;
        stageText.textContent = stages[analysis.sleepStage];

        // 움직임 레벨 업데이트
        const movementBar = document.getElementById('movementBar');
        const movementText = document.getElementById('movementText');
        movementBar.style.width = `${Math.min(analysis.movementLevel * 100, 100)}%`;
        movementText.textContent = analysis.movementLevel.toFixed(3);

        // 사이클 위치 업데이트
        const cycleBar = document.getElementById('cycleBar');
        const cycleText = document.getElementById('cycleText');
        cycleBar.style.width = `${analysis.cyclePosition * 100}%`;
        cycleText.textContent = `${(analysis.cyclePosition * 100).toFixed(1)}%`;
    }

async setAlarm() {
    const wakeTimeInput = document.getElementById('wakeTime');
    const wakeTime = wakeTimeInput.value;
    
    if (!wakeTime) {
        alert('기상 시간을 선택해주세요.');
        return;
    }

    if (!this.currentDeviceId) {
        alert('연결된 디바이스가 없습니다.');
        return;
    }

    // 👉 디밍 관련 값 가져오기
    const pattern = parseInt(document.getElementById('patternSelect').value) || 1;
    const maxBright = parseInt(document.getElementById('maxBrightInput').value) || 100;

    try {
        const response = await fetch('/api/alarm/set', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                targetWakeTime: new Date(wakeTime).getTime(),
                deviceId: this.currentDeviceId,
                pattern: pattern,
                maxBright: maxBright
            })
        });

        const result = await response.json();
        
        if (result.success) {
            this.addLog(`알람 설정됨: ${new Date(wakeTime).toLocaleString()}`, 'success');
            this.addLog(`알람 패턴: ${pattern}, 최대 밝기: ${maxBright}%`, 'info');
            
            document.getElementById('setAlarmBtn').disabled = true;
            document.getElementById('cancelAlarmBtn').disabled = false;

            if (result.alarmCalculation) {
                const optimalTime = new Date(result.alarmCalculation.recommendedTime);
                this.addLog(`최적 알람 시간: ${optimalTime.toLocaleString()}`, 'info');
            }
        } else {
            this.addLog(`알람 설정 실패: ${result.error}`, 'danger');
        }
    } catch (error) {
        console.error('알람 설정 오류:', error);
        this.addLog('알람 설정 중 오류 발생', 'danger');
    }
}

    async cancelAlarm() {
        if (!this.currentDeviceId) {
            alert('연결된 디바이스가 없습니다.');
            return;
        }

        try {
            const response = await fetch('/api/alarm/cancel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deviceId: this.currentDeviceId
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.addLog('알람이 취소되었습니다.', 'warning');
                
                // 버튼 상태 변경
                document.getElementById('setAlarmBtn').disabled = false;
                document.getElementById('cancelAlarmBtn').disabled = true;
            } else {
                this.addLog(`알람 취소 실패: ${result.error}`, 'danger');
            }
        } catch (error) {
            console.error('알람 취소 오류:', error);
            this.addLog('알람 취소 중 오류 발생', 'danger');
        }
    }

    handleSleepDetected(data) {
        if (data.deviceId !== this.currentDeviceId) return;
        
        const sleepInfo = data.sleepInfo;
        const alarmTime = new Date(sleepInfo.recommendedAlarmTime);
        
        this.addLog(`수면 감지됨! 알람 시간: ${alarmTime.toLocaleString()}`, 'success');
        this.addLog(`90분 사이클 ${sleepInfo.cyclesToTarget}개 후 기상`, 'info');
    }

    async startMonitoring() {
        if (!this.currentDeviceId) {
            alert('연결된 디바이스가 없습니다.');
            return;
        }

        try {
            const response = await fetch('/api/sleep/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deviceId: this.currentDeviceId
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.addLog('수면 모니터링이 시작되었습니다.', 'success');
                this.isMonitoring = true;
                
                // 버튼 상태 변경
                document.getElementById('startMonitoringBtn').disabled = true;
                document.getElementById('stopMonitoringBtn').disabled = false;
            } else {
                this.addLog(`모니터링 시작 실패: ${result.error}`, 'danger');
            }
        } catch (error) {
            console.error('모니터링 시작 오류:', error);
            this.addLog('모니터링 시작 중 오류 발생', 'danger');
        }
    }

    async stopMonitoring() {
        if (!this.currentDeviceId) {
            alert('연결된 디바이스가 없습니다.');
            return;
        }

        try {
            const response = await fetch('/api/sleep/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deviceId: this.currentDeviceId
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.addLog('수면 모니터링이 중지되었습니다.', 'warning');
                this.isMonitoring = false;
                
                // 버튼 상태 변경
                document.getElementById('startMonitoringBtn').disabled = false;
                document.getElementById('stopMonitoringBtn').disabled = true;
                
                // 모니터링 상태 업데이트
                document.getElementById('monitoringStatus').textContent = '대기 중';
                document.getElementById('monitoringStatus').className = 'text-muted';
            } else {
                this.addLog(`모니터링 중지 실패: ${result.error}`, 'danger');
            }
        } catch (error) {
            console.error('모니터링 중지 오류:', error);
            this.addLog('모니터링 중지 중 오류 발생', 'danger');
        }
    }

    calculateOptimalWakeTime() {
        const wakeTimeInput = document.getElementById('wakeTime');
        const wakeTime = wakeTimeInput.value;
        
        if (!wakeTime) return;

        const targetTime = new Date(wakeTime).getTime();
        const now = Date.now();
        const timeToTarget = targetTime - now;
        
        // 90분 사이클 계산
        const cycleDuration = 90 * 60 * 1000; // 90분
        const cyclesToTarget = Math.floor(timeToTarget / cycleDuration);
        const optimalTime = targetTime - (cyclesToTarget * cycleDuration);
        
        this.addLog(`목표 시간까지 ${cyclesToTarget}개 사이클`, 'info');
    }

    handleAlarmTriggered(data) {
        this.addLog('알람이 발생했습니다!', 'danger');
        
        // 모달 표시
        const modal = new bootstrap.Modal(document.getElementById('alarmModal'));
        modal.show();
        
        // 사운드 재생 (브라우저 지원 시)
        this.playAlarmSound();
    }

    playAlarmSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.log('사운드 재생을 지원하지 않는 브라우저입니다.');
        }
    }

    addLog(message, type = 'info') {
        const logContainer = document.getElementById('alarmLog');
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type} fade-in`;
        
        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `
            <div class="log-timestamp">${timestamp}</div>
            <div class="log-message">${message}</div>
        `;
        
        // 첫 번째 로그 항목이 기본 메시지인 경우 제거
        if (logContainer.children.length === 1 && 
            logContainer.children[0].textContent.includes('알람 로그가 여기에 표시됩니다')) {
            logContainer.innerHTML = '';
        }
        
        logContainer.insertBefore(logEntry, logContainer.firstChild);
        
        // 최대 50개 로그 항목만 유지
        while (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.lastChild);
        }
    }

    async loadDevices() {
        try {
            const response = await fetch('/api/devices');
            const result = await response.json();
            
            if (result.devices && result.devices.length > 0) {
                this.updateDeviceStatus(result.devices);
            }
        } catch (error) {
            console.error('디바이스 로드 오류:', error);
        }
    }

    // 디밍 제어 메서드들

    async bulbPower(on) {
        if (!this.currentDeviceId) {
            alert('연결된 디바이스가 없습니다.');
            return;
        }

        try {
            const response = await fetch('/api/dimmer/power', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deviceId: this.currentDeviceId,
                    on: on
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.addLog(`전구 전원: ${on ? 'ON' : 'OFF'}`, on ? 'success' : 'warning');
            } else {
                this.addLog(`전구 전원 제어 실패: ${result.error}`, 'danger');
            }
        } catch (error) {
            console.error('전구 전원 제어 오류:', error);
            this.addLog('전구 전원 제어 중 오류 발생', 'danger');
        }
    }

    async startDimmingPattern() {
        if (!this.currentDeviceId) {
            alert('연결된 디바이스가 없습니다.');
            return;
        }

        const pattern = parseInt(document.getElementById('patternSelect').value);
        const maxBright = parseInt(document.getElementById('maxBrightInput').value);

        if (maxBright < 16 || maxBright > 100) {
            alert('최대 밝기는 16-100 사이의 값이어야 합니다.');
            return;
        }

        try {
            const response = await fetch('/api/dimmer/pattern', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deviceId: this.currentDeviceId,
                    pattern: pattern,
                    maxBright: maxBright
                })
            });

            const result = await response.json();
            
            if (result.success) {
                const patternNames = ['', 'SMOOTH', 'STEP', 'PULSE', 'SAW'];
                this.addLog(`디밍 패턴 시작: ${patternNames[pattern]}, 최대 밝기: ${maxBright}%`, 'success');
            } else {
                this.addLog(`디밍 패턴 시작 실패: ${result.error}`, 'danger');
            }
        } catch (error) {
            console.error('디밍 패턴 시작 오류:', error);
            this.addLog('디밍 패턴 시작 중 오류 발생', 'danger');
        }
    }

    async setBrightness() {
        if (!this.currentDeviceId) {
            alert('연결된 디바이스가 없습니다.');
            return;
        }

        const level = parseInt(document.getElementById('brightnessSlider').value);

        if (level < 16 || level > 100) {
            alert('밝기는 16-100 사이의 값이어야 합니다.');
            return;
        }

        try {
            const response = await fetch('/api/dimmer/brightness', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deviceId: this.currentDeviceId,
                    level: level
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.addLog(`밝기 설정: ${level}%`, 'success');
            } else {
                this.addLog(`밝기 설정 실패: ${result.error}`, 'danger');
            }
        } catch (error) {
            console.error('밝기 설정 오류:', error);
            this.addLog('밝기 설정 중 오류 발생', 'danger');
        }
    }
}

// 앱 초기화
document.addEventListener('DOMContentLoaded', () => {
    new SleepAlarmApp();
});
