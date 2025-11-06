#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <deque>
#define SERIAL_BAUD_RATE 115200
#define DEBUG_MEASURE
#define DEBUG_NET

// WiFi 및 서버 설정 (실제 값으로 변경 필요)
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define SERVER_HOST   "192.168.1.100"  // 라즈베리파이 IP 주소
#define SERVER_PORT   8080

static uint8_t log_level = 5;

#define st_debug_print(lvl, _fs)    \
  do {                              \
    if (log_level >= lvl)           \
      Serial.println((_fs));        \
  } while (0)

/**
 * 수면 상태를 나타내는 구조체
 */
struct sleep_data {
    float x, y, z;           // 가속도계 데이터 (g 단위)
    float roll, pitch;        // 회전각
    unsigned long timestamp;  // 타임스탬프
    uint8_t sleep_stage;      // 수면 단계 (0: 깨어있음, 1: 얕은잠, 2: 깊은잠)
    float movement_score;     // 움직임 점수

    void dump()
    {
        char str[128];
        snprintf(str, sizeof(str), "Time:%lu X:%.3f Y:%.3f Z:%.3f Roll:%.1f Pitch:%.1f Stage:%d Move:%.3f",
                 timestamp, x, y, z, roll, pitch, sleep_stage, movement_score);
        st_debug_print(1, str);
    }
};

/**
 * ADXL345 가속도계 클래스 (기존 코드 기반)
 */
template <uint8_t DEV = 0x53, uint8_t RESOLUTION = 0x0>
class adxl345 {
public:
    adxl345()
      : kMult{256.0 / pow(2, RESOLUTION)}
    {
        this->write(DEV, 0x2D, 0);   // Power Control Register 초기화
        this->write(DEV, 0x2D, 16);  // 측정 모드 활성화
        this->write(DEV, 0x2D, 8);   // 측정 시작
    }

    sleep_data read_sleep_data()
    {
        sleep_data data;
        byte raw_data[6];
        int16_t xi, yi, zi;

        this->write(DEV, 0x31, RESOLUTION);  // 데이터 포맷 설정
        this->read(DEV, 0x32, 6, raw_data);  // 데이터 읽기

        xi = (int16_t)(raw_data[1] << 8) | raw_data[0];
        yi = (int16_t)(raw_data[3] << 8) | raw_data[2];
        zi = (int16_t)(raw_data[5] << 8) | raw_data[4];

        data.x = xi / kMult;
        data.y = yi / kMult;
        data.z = zi / kMult;
        data.roll = atan2(yi, zi) * 57.3;
        data.pitch = atan2((-xi), sqrt(yi * yi + zi * zi)) * 57.3;
        data.timestamp = millis();
        
        // 움직임 점수 계산 (가속도 변화량 기반)
        data.movement_score = sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
        
        // 간단한 수면 단계 판단 (움직임 기반)
        if (data.movement_score < 0.1) {
            data.sleep_stage = 2;  // 깊은잠
        } else if (data.movement_score < 0.3) {
            data.sleep_stage = 1;  // 얕은잠
        } else {
            data.sleep_stage = 0;  // 깨어있음
        }

        return data;
    }

private:
    const float kMult;
    
    void read(int dev, byte addr, int num, byte data[])
    {
        Wire.beginTransmission(dev);
        Wire.write(addr);
        Wire.endTransmission();
        Wire.requestFrom(dev, num);
        for (int i = 0; i < num; i++) {
            if(Wire.available()) {
                data[i] = Wire.read();
            }
        }
        Wire.endTransmission();
    }
     
    void write(int dev, byte addr, byte val)
    {
        Wire.beginTransmission(dev);
        Wire.write(addr);
        Wire.write(val);
        Wire.endTransmission();
    }
};

/**
 * 수면 모니터링 및 알람 관리 클래스
 */
using namespace websockets;

class SleepMonitor {
private:
    adxl345<> accelerometer;
    WebsocketsClient wsClient;
    std::deque<sleep_data> sleep_buffer;
    bool is_monitoring = false;
    bool alarm_active = false;
    unsigned long alarm_time = 0;
    unsigned long last_send_time = 0;
    const unsigned long SEND_INTERVAL = 5000; // 5초마다 데이터 전송
    
    bool ws_connected = false;
    unsigned long last_reconnect_try = 0;
    const unsigned long RECONNECT_INTERVAL = 5000;
    
    // 알람 관련 핀
    const int BUZZER_PIN = 2;
    const int LED_PIN = 4;

public:
    void begin() {
        Wire.begin();
        pinMode(BUZZER_PIN, OUTPUT);
        pinMode(LED_PIN, OUTPUT);
        
        // WebSocket 연결 설정 (ArduinoWebsockets)
        wsClient.onMessage([this](WebsocketsMessage msg){
            String payload = msg.data();
            handleServerMessage(payload.c_str());
        });
        wsClient.onEvent([this](WebsocketsEvent event, String data){
            if (event == WebsocketsEvent::ConnectionOpened) {
                ws_connected = true;
                st_debug_print(2, "WebSocket Connected");
                sendDeviceStatus();
            } else if (event == WebsocketsEvent::ConnectionClosed) {
                ws_connected = false;
                st_debug_print(2, "WebSocket Disconnected");
            } else if (event == WebsocketsEvent::GotPing) {
                wsClient.pong();
            }
        });
        connectWebSocket();
        
        st_debug_print(2, "Sleep Monitor initialized");
    }

    void loop() {
        // WebSocket 폴링 및 자동 재연결
        if (ws_connected) {
            wsClient.poll();
        } else if (millis() - last_reconnect_try > RECONNECT_INTERVAL) {
            connectWebSocket();
        }
        
        if (is_monitoring) {
            sleep_data data = accelerometer.read_sleep_data();
            sleep_buffer.push_back(data);
            
            // 버퍼 크기 제한 (최근 100개 데이터만 유지)
            if (sleep_buffer.size() > 100) {
                sleep_buffer.pop_front();
            }
            
            // 주기적으로 서버에 데이터 전송
            if (millis() - last_send_time > SEND_INTERVAL) {
                sendSleepData();
                last_send_time = millis();
            }
            
#ifdef DEBUG_MEASURE
            data.dump();
#endif
        }
        
        // 알람 체크
        if (alarm_active && millis() >= alarm_time) {
            triggerAlarm();
        }
        
        delay(100); // 10Hz 샘플링
    }

private:
    void connectWebSocket() {
        last_reconnect_try = millis();
        String url = String("ws://") + SERVER_HOST + ":" + String(SERVER_PORT) + "/ws";
        st_debug_print(2, String("Connecting WS: ") + url);
        ws_connected = wsClient.connect(url);
        if (!ws_connected) {
            st_debug_print(2, "WebSocket connect failed");
        }
    }

    void handleServerMessage(const char* message) {
        DynamicJsonDocument doc(1024);
        deserializeJson(doc, message);
        
        String command = doc["command"];
        
        if (command == "start_monitoring") {
            startMonitoring();
        }
        else if (command == "stop_monitoring") {
            stopMonitoring();
        }
        else if (command == "set_alarm") {
            unsigned long alarm_timestamp = doc["alarm_time"];
            setAlarm(alarm_timestamp);
        }
        else if (command == "cancel_alarm") {
            cancelAlarm();
        }
    }

    void startMonitoring() {
        is_monitoring = true;
        sleep_buffer.clear();
        st_debug_print(2, "Sleep monitoring started");
        
        // 서버에 모니터링 시작 알림
        DynamicJsonDocument doc(256);
        doc["device_id"] = "ESP32_001";
        doc["status"] = "monitoring_started";
        doc["timestamp"] = millis();
        
        String response;
        serializeJson(doc, response);
        if (ws_connected) wsClient.send(response);
    }

    void stopMonitoring() {
        is_monitoring = false;
        st_debug_print(2, "Sleep monitoring stopped");
        
        // 서버에 모니터링 중지 알림
        DynamicJsonDocument doc(256);
        doc["device_id"] = "ESP32_001";
        doc["status"] = "monitoring_stopped";
        doc["timestamp"] = millis();
        
        String response;
        serializeJson(doc, response);
        if (ws_connected) wsClient.send(response);
    }

    void setAlarm(unsigned long timestamp) {
        alarm_time = timestamp;
        alarm_active = true;
        st_debug_print(2, "Alarm set for: " + String(timestamp));
    }

    void cancelAlarm() {
        alarm_active = false;
        alarm_time = 0;
        st_debug_print(2, "Alarm cancelled");
    }

    void triggerAlarm() {
        st_debug_print(2, "ALARM TRIGGERED!");
        
        // 부저와 LED로 알람 발생
        for (int i = 0; i < 10; i++) {
            digitalWrite(BUZZER_PIN, HIGH);
            digitalWrite(LED_PIN, HIGH);
            delay(200);
            digitalWrite(BUZZER_PIN, LOW);
            digitalWrite(LED_PIN, LOW);
            delay(200);
        }
        
        alarm_active = false;
        
        // 서버에 알람 발생 알림
        DynamicJsonDocument doc(256);
        doc["device_id"] = "ESP32_001";
        doc["status"] = "alarm_triggered";
        doc["timestamp"] = millis();
        
        String response;
        serializeJson(doc, response);
        if (ws_connected) wsClient.send(response);
    }

    void sendSleepData() {
        if (sleep_buffer.empty()) return;
        
        DynamicJsonDocument doc(2048);
        doc["device_id"] = "ESP32_001";
        doc["data_type"] = "sleep_data";
        doc["timestamp"] = millis();
        
        JsonArray data_array = doc.createNestedArray("data");
        
        // 최근 데이터들을 JSON 배열로 변환
        for (const auto& data : sleep_buffer) {
            JsonObject data_obj = data_array.createNestedObject();
            data_obj["x"] = data.x;
            data_obj["y"] = data.y;
            data_obj["z"] = data.z;
            data_obj["roll"] = data.roll;
            data_obj["pitch"] = data.pitch;
            data_obj["timestamp"] = data.timestamp;
            data_obj["sleep_stage"] = data.sleep_stage;
            data_obj["movement_score"] = data.movement_score;
        }
        
        String response;
        serializeJson(doc, response);
        if (ws_connected) wsClient.send(response);
        
        sleep_buffer.clear(); // 전송 후 버퍼 클리어
    }

    void sendDeviceStatus() {
        DynamicJsonDocument doc(256);
        doc["device_id"] = "ESP32_001";
        doc["status"] = "connected";
        doc["timestamp"] = millis();
        doc["monitoring"] = is_monitoring;
        doc["alarm_active"] = alarm_active;
        
        String response;
        serializeJson(doc, response);
        if (ws_connected) wsClient.send(response);
    }
};

SleepMonitor sleepMonitor;

void setup() {
    Serial.begin(SERIAL_BAUD_RATE);
    
    // WiFi 연결
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) {
        delay(1000);
        st_debug_print(2, "Connecting to WiFi...");
    }
    
    st_debug_print(2, "WiFi connected!");
    st_debug_print(2, "IP address: " + WiFi.localIP().toString());
    
    sleepMonitor.begin();
}

void loop() {
    sleepMonitor.loop();
}
