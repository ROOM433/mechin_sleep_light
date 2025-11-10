#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <deque>
#include <RBDdimmer.h>
#define SERIAL_BAUD_RATE 115200
#define DEBUG_MEASURE
#define DEBUG_NET

// WiFi 및 서버 설정 (실제 값으로 변경 필요)
#define WIFI_SSID     "둠별2.4"
#define WIFI_PASSWORD "75450111"
#define SERVER_HOST   "192.168.1.10"  // 라즈베리파이 IP 주소
#define SERVER_PORT   8080

static uint8_t log_level = 5;

#define st_debug_print(lvl, _fs)    \
  do {                              \
    if (log_level >= lvl)           \
      Serial.println((_fs));        \
  } while (0)

/**
 * 수면 상태를 나타내는 구조체 (9축 IMU 지원)
 */
struct sleep_data {
    // 가속도계 데이터 (ADXL345)
    float accel_x, accel_y, accel_z;  // 가속도 (g 단위)
    
    // 자이로스코프 데이터 (ITG3205)
    float gyro_x, gyro_y, gyro_z;    // 각속도 (deg/s)
    
    // 자기계 데이터 (HMC5883)
    float mag_x, mag_y, mag_z;        // 자기장 (mG)
    
    // 융합된 자세 정보
    float roll, pitch, yaw;           // 회전각 (도)
    
    unsigned long timestamp;          // 타임스탬프
    uint8_t sleep_stage;              // 수면 단계 (0: 깨어있음, 1: 얕은잠, 2: 깊은잠)
    float movement_score;             // 움직임 점수

    void dump()
    {
        char str[256];
        snprintf(str, sizeof(str), 
                 "Time:%lu Accel[%.3f,%.3f,%.3f] Gyro[%.1f,%.1f,%.1f] Mag[%.1f,%.1f,%.1f] RPY[%.1f,%.1f,%.1f] Stage:%d Move:%.3f",
                 timestamp, accel_x, accel_y, accel_z, 
                 gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z,
                 roll, pitch, yaw, sleep_stage, movement_score);
        st_debug_print(1, str);
    }
};

/**
 * 가속도 센서 모의 클래스 (테스트용)
 * 실제 하드웨어 없이 시리얼 모니터에서 테스트 가능
 */
class MockAccelerometer {
private:
    float base_x = 0.0, base_y = 0.0, base_z = 1.0;  // 기본 중력 방향
    unsigned long last_update = 0;
    float noise_level = 0.02;  // 노이즈 레벨
    bool movement_simulation = false;
    float movement_amplitude = 0.1;

public:
    MockAccelerometer() {
        last_update = millis();
    }

    sleep_data read_sleep_data() {
        sleep_data data;
        unsigned long now = millis();
        float dt = (now - last_update) / 1000.0f;  // 초 단위
        last_update = now;

        // 간단한 움직임 시뮬레이션 (사인파 기반)
        if (movement_simulation) {
            float t = now / 1000.0f;
            base_x = 0.05 * sin(t * 0.5);
            base_y = 0.03 * cos(t * 0.3);
            base_z = 1.0 + 0.02 * sin(t * 0.2);
        }

        // 노이즈 추가
        data.accel_x = base_x + (random(-100, 100) / 10000.0f) * noise_level;
        data.accel_y = base_y + (random(-100, 100) / 10000.0f) * noise_level;
        data.accel_z = base_z + (random(-100, 100) / 10000.0f) * noise_level;

        // 모의 자이로 데이터
        data.gyro_x = (random(-50, 50) / 10.0f) * noise_level;
        data.gyro_y = (random(-50, 50) / 10.0f) * noise_level;
        data.gyro_z = (random(-50, 50) / 10.0f) * noise_level;

        // 모의 자기계 데이터
        data.mag_x = 100.0 + (random(-20, 20) / 10.0f);
        data.mag_y = 200.0 + (random(-20, 20) / 10.0f);
        data.mag_z = 300.0 + (random(-20, 20) / 10.0f);

        // 회전각 계산
        int16_t xi = (int16_t)(data.accel_x * 256);
        int16_t yi = (int16_t)(data.accel_y * 256);
        int16_t zi = (int16_t)(data.accel_z * 256);
        data.roll = atan2(yi, zi) * 57.3;
        data.pitch = atan2((-xi), sqrt(yi * yi + zi * zi)) * 57.3;
        data.yaw = atan2(data.mag_y, data.mag_x) * 57.3;
        data.timestamp = now;

        // 움직임 점수 계산
        float accel_mag = sqrt(data.accel_x * data.accel_x + 
                              data.accel_y * data.accel_y + 
                              data.accel_z * data.accel_z);
        float gyro_mag = sqrt(data.gyro_x * data.gyro_x + 
                             data.gyro_y * data.gyro_y + 
                             data.gyro_z * data.gyro_z);
        data.movement_score = accel_mag + (gyro_mag / 100.0);

        // 수면 단계 판단
        if (data.movement_score < 0.15) {
            data.sleep_stage = 2;  // 깊은잠
        } else if (data.movement_score < 0.4) {
            data.sleep_stage = 1;  // 얕은잠
        } else {
            data.sleep_stage = 0;  // 깨어있음
        }

        // 시리얼 모니터 피드백
        char msg[256];
        snprintf(msg, sizeof(msg), 
                 "[MOCK_IMU] Accel[%.3f,%.3f,%.3f] Gyro[%.1f,%.1f,%.1f] RPY[%.1f,%.1f,%.1f] Stage:%d",
                 data.accel_x, data.accel_y, data.accel_z,
                 data.gyro_x, data.gyro_y, data.gyro_z,
                 data.roll, data.pitch, data.yaw, data.sleep_stage);
        st_debug_print(1, msg);

        return data;
    }

    void setMovementSimulation(bool enable) {
        movement_simulation = enable;
        char msg[64];
        snprintf(msg, sizeof(msg), "[MOCK_ACCEL] Movement simulation: %s", enable ? "ON" : "OFF");
        st_debug_print(2, msg);
    }

    void setNoiseLevel(float level) {
        noise_level = constrain(level, 0.0, 1.0);
        char msg[64];
        snprintf(msg, sizeof(msg), "[MOCK_ACCEL] Noise level set to: %.3f", noise_level);
        st_debug_print(2, msg);
    }
};

/**
 * ITG3205 자이로스코프 클래스
 * I2C 주소: 0x68
 */
class ITG3205 {
private:
    const uint8_t DEV_ADDR = 0x68;
    const float GYRO_SCALE = 14.375;  // ±2000°/s 범위, 16-bit

public:
    ITG3205() {
        // Power Management Register 설정
        write(0x3E, 0x00);  // 샘플 레이트 분할기
        write(0x15, 0x07);  // 샘플 레이트 = 1kHz / (1+7) = 125Hz
        write(0x16, 0x18);  // DLPF 설정, ±2000°/s 범위
        write(0x3E, 0x01);  // PLL with X axis gyro reference
    }

    void read_gyro(float &gx, float &gy, float &gz) {
        byte data[6];
        read(0x1D, 6, data);  // GYRO_XOUT_H부터 6바이트 읽기
        
        int16_t gx_raw = (int16_t)(data[0] << 8) | data[1];
        int16_t gy_raw = (int16_t)(data[2] << 8) | data[3];
        int16_t gz_raw = (int16_t)(data[4] << 8) | data[5];
        
        gx = gx_raw / GYRO_SCALE;
        gy = gy_raw / GYRO_SCALE;
        gz = gz_raw / GYRO_SCALE;
    }

private:
    void read(uint8_t addr, uint8_t num, byte data[]) {
        Wire.beginTransmission(DEV_ADDR);
        Wire.write(addr);
        Wire.endTransmission();
        Wire.requestFrom(DEV_ADDR, num);
        for (int i = 0; i < num; i++) {
            if(Wire.available()) {
                data[i] = Wire.read();
            }
        }
    }

    void write(uint8_t addr, uint8_t val) {
        Wire.beginTransmission(DEV_ADDR);
        Wire.write(addr);
        Wire.write(val);
        Wire.endTransmission();
    }
};

/**
 * HMC5883 자기계(나침반) 클래스
 * I2C 주소: 0x1E
 */
class HMC5883 {
private:
    const uint8_t DEV_ADDR = 0x1E;
    const float MAG_SCALE = 0.92;  // ±1.3 Ga 범위, 1090 LSB/Gauss

public:
    HMC5883() {
        // Configuration Register A
        write(0x00, 0x78);  // 8 샘플 평균, 75Hz 데이터 출력, 정상 측정 모드
        // Configuration Register B
        write(0x01, 0x20);  // ±1.3 Ga 범위
        // Mode Register
        write(0x02, 0x00);  // 연속 측정 모드
    }

    void read_magnetometer(float &mx, float &my, float &mz) {
        byte data[6];
        read(0x03, 6, data);  // Data Output X MSB Register부터 6바이트
        
        int16_t mx_raw = (int16_t)(data[0] << 8) | data[1];
        int16_t mz_raw = (int16_t)(data[2] << 8) | data[3];
        int16_t my_raw = (int16_t)(data[4] << 8) | data[5];
        
        // HMC5883은 X, Z, Y 순서로 데이터를 제공
        mx = mx_raw / MAG_SCALE;
        my = my_raw / MAG_SCALE;
        mz = mz_raw / MAG_SCALE;
    }

private:
    void read(uint8_t addr, uint8_t num, byte data[]) {
        Wire.beginTransmission(DEV_ADDR);
        Wire.write(addr);
        Wire.endTransmission();
        Wire.requestFrom(DEV_ADDR, num);
        for (int i = 0; i < num; i++) {
            if(Wire.available()) {
                data[i] = Wire.read();
            }
        }
    }

    void write(uint8_t addr, uint8_t val) {
        Wire.beginTransmission(DEV_ADDR);
        Wire.write(addr);
        Wire.write(val);
        Wire.endTransmission();
    }
};

/**
 * ADXL345 가속도계 클래스 (실제 하드웨어용)
 * I2C 주소: 0x53
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

    void read_accelerometer(float &ax, float &ay, float &az) {
        byte raw_data[6];
        this->write(DEV, 0x31, RESOLUTION);  // 데이터 포맷 설정
        this->read(DEV, 0x32, 6, raw_data);  // 데이터 읽기

        int16_t xi = (int16_t)(raw_data[1] << 8) | raw_data[0];
        int16_t yi = (int16_t)(raw_data[3] << 8) | raw_data[2];
        int16_t zi = (int16_t)(raw_data[5] << 8) | raw_data[4];

        ax = xi / kMult;
        ay = yi / kMult;
        az = zi / kMult;
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
 * 9축 IMU 융합 클래스
 * ADXL345, ITG3205, HMC5883을 통합하여 자세 계산
 */
class IMU9DOF {
private:
    adxl345<> accel;
    ITG3205 gyro;
    HMC5883 mag;
    
    // 자세 보정을 위한 오프셋
    float gyro_offset_x = 0, gyro_offset_y = 0, gyro_offset_z = 0;
    bool calibrated = false;

public:
    IMU9DOF() {
        // 센서 초기화는 생성자에서 자동으로 수행됨
    }

    /**
     * 자이로 오프셋 캘리브레이션 (정지 상태에서 호출)
     */
    void calibrate_gyro() {
        float sum_x = 0, sum_y = 0, sum_z = 0;
        const int samples = 100;
        
        st_debug_print(2, "[IMU] Calibrating gyro...");
        for (int i = 0; i < samples; i++) {
            float gx, gy, gz;
            gyro.read_gyro(gx, gy, gz);
            sum_x += gx;
            sum_y += gy;
            sum_z += gz;
            delay(10);
        }
        
        gyro_offset_x = sum_x / samples;
        gyro_offset_y = sum_y / samples;
        gyro_offset_z = sum_z / samples;
        calibrated = true;
        
        char msg[128];
        snprintf(msg, sizeof(msg), "[IMU] Gyro offset: X=%.2f Y=%.2f Z=%.2f", 
                 gyro_offset_x, gyro_offset_y, gyro_offset_z);
        st_debug_print(2, msg);
    }

    /**
     * 9축 데이터 읽기 및 자세 계산
     */
    sleep_data read_sleep_data() {
        sleep_data data;
        
        // 가속도계 읽기
        accel.read_accelerometer(data.accel_x, data.accel_y, data.accel_z);
        
        // 자이로스코프 읽기
        gyro.read_gyro(data.gyro_x, data.gyro_y, data.gyro_z);
        if (calibrated) {
            data.gyro_x -= gyro_offset_x;
            data.gyro_y -= gyro_offset_y;
            data.gyro_z -= gyro_offset_z;
        }
        
        // 자기계 읽기
        mag.read_magnetometer(data.mag_x, data.mag_y, data.mag_z);
        
        data.timestamp = millis();
        
        // 자세 계산 (가속도계와 자기계 기반)
        // Roll: X축 회전 (Y, Z 가속도 사용)
        data.roll = atan2(data.accel_y, data.accel_z) * 57.3;
        
        // Pitch: Y축 회전 (X, Z 가속도 사용)
        data.pitch = atan2(-data.accel_x, 
                           sqrt(data.accel_y * data.accel_y + data.accel_z * data.accel_z)) * 57.3;
        
        // Yaw: Z축 회전 (자기계 사용)
        float mag_x_cal = data.mag_x * cos(data.pitch * 0.0174533) + 
                          data.mag_z * sin(data.pitch * 0.0174533);
        float mag_y_cal = data.mag_x * sin(data.roll * 0.0174533) * sin(data.pitch * 0.0174533) +
                          data.mag_y * cos(data.roll * 0.0174533) -
                          data.mag_z * sin(data.roll * 0.0174533) * cos(data.pitch * 0.0174533);
        data.yaw = atan2(mag_y_cal, mag_x_cal) * 57.3;
        
        // 움직임 점수 계산 (가속도 변화량 + 자이로 변화량)
        float accel_magnitude = sqrt(data.accel_x * data.accel_x + 
                                     data.accel_y * data.accel_y + 
                                     data.accel_z * data.accel_z);
        float gyro_magnitude = sqrt(data.gyro_x * data.gyro_x + 
                                    data.gyro_y * data.gyro_y + 
                                    data.gyro_z * data.gyro_z);
        data.movement_score = accel_magnitude + (gyro_magnitude / 100.0);  // 자이로는 스케일 조정
        
        // 수면 단계 판단 (개선된 알고리즘)
        if (data.movement_score < 0.15) {
            data.sleep_stage = 2;  // 깊은잠
        } else if (data.movement_score < 0.4) {
            data.sleep_stage = 1;  // 얕은잠
        } else {
            data.sleep_stage = 0;  // 깨어있음
        }
        
        return data;
    }
};

// ===== 디밍 하드웨어 설정 =====
#define OUTPUT_PIN  12      // Triac gate
#define ZEROCROSS_PIN 13    // Zero-cross input (보드에 맞게 조정)

dimmerLamp dimmer(OUTPUT_PIN, ZEROCROSS_PIN);

// ===== Brightness lower bound =====
const uint8_t MIN_BRIGHT = 16;   // 전구 밝기 16 밑으로 가면 오히려 밝기가 더 밝아지는 미친 버그 있음

inline int clampBright(int v) { return constrain(v, MIN_BRIGHT, 100); }
inline void setPowerClampedDirect(int v) { dimmer.setPower(clampBright(v)); }

// ===== Dimming engine state =====
enum { PATTERN_SMOOTH = 1, PATTERN_STEP = 2, PATTERN_PULSE = 3, PATTERN_SAW = 4 };

struct DimState {
    uint8_t  pattern = 0;          // 1~4
    uint8_t  maxBright = 100;      // MIN_BRIGHT~100
    int      current = MIN_BRIGHT; // MIN_BRIGHT~maxBright
    int      direction = 1;        // +1 / -1
    uint8_t  phase = 0;            // for PULSE
    unsigned long phaseStart = 0;  // for PULSE hold timing
    unsigned long lastUpdate = 0;
    unsigned int  interval = 15;   // ms between steps
    bool     running = false;
} dimst;

/**
 * 디밍 제어 클래스 (실제 하드웨어 사용)
 */
class DimmerController {
private:
    uint8_t current_brightness = MIN_BRIGHT;  // 현재 밝기 (MIN_BRIGHT-100)
    // 선라이즈 상태
    bool sunrise_active = false;
    unsigned long sunrise_start_time = 0;
    unsigned long sunrise_duration = 0;
    uint8_t sunrise_target = 100;
    uint8_t sunrise_start_level = MIN_BRIGHT;

public:
    /**
     * 디머 초기화
     */
    void begin() {
        dimmer.begin(NORMAL_MODE, ON);
        current_brightness = MIN_BRIGHT;
        st_debug_print(2, "[DIMMER] Dimmer initialized");
    }

    /**
     * 전구 전원 켜/끄기
     * @param on true=켜기, false=끄기
     */
    void bulbPower(bool on) {
        if (on) {
            dimmer.setState(ON);
            st_debug_print(2, "[DIMMER] Bulb power: ON");
        } else {
            dimst.running = false;     // 패턴 중지
            dimmer.setState(OFF);
            st_debug_print(2, "[DIMMER] Bulb power: OFF");
        }
    }

    /**
     * 디밍 패턴 시작
     * @param pattern 패턴 번호 (1=SMOOTH, 2=STEP, 3=PULSE, 4=SAW)
     * @param maxBright 최대 밝기 (16-100)
     */
    void bulbDimming(uint8_t pattern, uint8_t maxBright) {
        dimst.pattern   = constrain(pattern, 1, 4);
        dimst.maxBright = max((int)MIN_BRIGHT, (int)constrain(maxBright, 10, 100));
        dimst.current   = MIN_BRIGHT;
        dimst.direction = 1;
        dimst.phase     = 0;
        dimst.phaseStart= millis();
        dimst.lastUpdate= millis();
        dimst.running   = true;

        // 패턴별 속도(원하면 조정)
        switch (dimst.pattern) {
            case PATTERN_SMOOTH: dimst.interval = 10; break; // 부드럽게
            case PATTERN_STEP:   dimst.interval = 80; break; // 계단식
            case PATTERN_PULSE:  dimst.interval = 10; break; // 페이드 속도
            case PATTERN_SAW:    dimst.interval = 6;  break; // 빠른 램프
        }

        dimmer.setState(ON);  // 패턴 시작 시 전원 보장
        
        char msg[128];
        snprintf(msg, sizeof(msg), "[DIMMER] Pattern %d started, maxBright: %d", pattern, dimst.maxBright);
        st_debug_print(2, msg);
    }

    /**
     * 밝기 고정 설정 (패턴 중지)
     * @param level 밝기 레벨 (16-100)
     */
    void setPowerClamped(int level) {
        dimst.running = false;  // 패턴 중지
        setPowerClampedDirect(level);
        current_brightness = clampBright(level);
        
        char msg[64];
        snprintf(msg, sizeof(msg), "[DIMMER] Brightness set to %d%%", current_brightness);
        st_debug_print(2, msg);
    }

    /**
     * 현재 밝기 읽기
     */
    uint8_t getBrightness() {
        return current_brightness;
    }

    /**
     * 디밍/선라이즈 업데이트 (loop에서 주기적으로 호출)
     */
    void updateDimming() {
        // 선라이즈 우선 처리
        if (sunrise_active) {
            unsigned long elapsed = millis() - sunrise_start_time;
            if (elapsed >= sunrise_duration) {
                setPowerClampedDirect(sunrise_target);
                current_brightness = clampBright(sunrise_target);
                sunrise_active = false;
            } else {
                float progress = (float)elapsed / (float)sunrise_duration;
                int new_level = sunrise_start_level +
                                (int)((int)sunrise_target - (int)sunrise_start_level) * progress;
                setPowerClampedDirect(new_level);
                current_brightness = clampBright(new_level);
            }
            return;
        }

        if (!dimst.running) return;

        const unsigned long now = millis();
        if (now - dimst.lastUpdate < dimst.interval) return;

        dimst.lastUpdate = now;

        switch (dimst.pattern) {
            case PATTERN_SMOOTH: { // MIN_BRIGHT↔max 사이 왕복
                dimst.current += dimst.direction;
                if (dimst.current >= dimst.maxBright) { 
                    dimst.current = dimst.maxBright; 
                    dimst.direction = -1; 
                }
                else if (dimst.current <= (int)MIN_BRIGHT) { 
                    dimst.current = MIN_BRIGHT; 
                    dimst.direction = +1; 
                }
                setPowerClampedDirect(dimst.current);
                current_brightness = dimst.current;
            } break;

            case PATTERN_STEP: {   // MIN_BRIGHT→(¼ 범위씩)→max 왕복
                int range = max(1, dimst.maxBright - (int)MIN_BRIGHT);
                int step = max(1, range / 4);
                dimst.current += (dimst.direction > 0 ? step : -step);
                if (dimst.current >= dimst.maxBright) { 
                    dimst.current = dimst.maxBright; 
                    dimst.direction = -1; 
                }
                else if (dimst.current <= (int)MIN_BRIGHT) { 
                    dimst.current = MIN_BRIGHT; 
                    dimst.direction = +1; 
                }
                setPowerClampedDirect(dimst.current);
                current_brightness = dimst.current;
            } break;

            case PATTERN_PULSE: {  // 페이드업→최대유지→페이드다운→오프유지 반복
                const unsigned holdMs = 300; // 유지 시간
                switch (dimst.phase) {
                    case 0: // fade up
                        if (dimst.current < (int)MIN_BRIGHT) dimst.current = MIN_BRIGHT;
                        dimst.current++;
                        if (dimst.current >= dimst.maxBright) { 
                            dimst.current = dimst.maxBright; 
                            dimst.phase = 1; 
                            dimst.phaseStart = now; 
                        }
                        setPowerClampedDirect(dimst.current);
                        current_brightness = dimst.current;
                        break;
                    case 1: // hold max
                        if (now - dimst.phaseStart >= holdMs) dimst.phase = 2;
                        break;
                    case 2: // fade down
                        dimst.current--;
                        if (dimst.current <= (int)MIN_BRIGHT) { 
                            dimst.current = MIN_BRIGHT; 
                            dimst.phase = 3; 
                            dimst.phaseStart = now; 
                        }
                        setPowerClampedDirect(dimst.current);
                        current_brightness = dimst.current;
                        break;
                    case 3: // hold off (MIN_BRIGHT)
                        if (now - dimst.phaseStart >= holdMs) dimst.phase = 0;
                        break;
                }
            } break;

            case PATTERN_SAW: {    // MIN_BRIGHT→max 선형 상승 후 즉시 MIN_BRIGHT로 점프
                if (dimst.current < (int)MIN_BRIGHT) dimst.current = MIN_BRIGHT;
                dimst.current++;
                if (dimst.current > dimst.maxBright) dimst.current = MIN_BRIGHT;
                setPowerClampedDirect(dimst.current);
                current_brightness = dimst.current;
            } break;
        }
    }

    /**
     * 패턴 실행 중인지 확인
     */
    bool isPatternRunning() {
        return dimst.running;
    }

    /**
     * 선라이즈(일출 효과) 시작
     * @param duration_ms 선라이즈 지속 시간 (밀리초)
     * @param target_level 목표 밝기 (16-100)
     */
    void startSunrise(unsigned long duration_ms, uint8_t target_level) {
        sunrise_start_level = max((int)MIN_BRIGHT, (int)current_brightness);
        sunrise_target = clampBright(target_level);
        sunrise_duration = max(1UL, duration_ms);
        sunrise_start_time = millis();
        sunrise_active = true;
        // 패턴은 일시 중지
        dimst.running = false;
        dimmer.setState(ON);
        char msg[128];
        snprintf(msg, sizeof(msg), "[SUNRISE] %d%% -> %d%% over %lu ms",
                 sunrise_start_level, sunrise_target, sunrise_duration);
        st_debug_print(2, msg);
    }

    /**
     * 선라이즈 취소
     */
    void cancelSunrise() {
        if (sunrise_active) {
            sunrise_active = false;
            st_debug_print(2, "[SUNRISE] Cancelled");
        }
    }

    /**
     * 선라이즈 동작 여부
     */
    bool isSunriseActive() const {
        return sunrise_active;
    }

    /**
     * 패턴 실행 중인지 확인
     */
    // 위에 구현됨
};

/**
 * 수면 모니터링 및 알람 관리 클래스
 */
using namespace websockets;

class SleepMonitor {
private:
    IMU9DOF imu9dof;                // 9축 IMU 센서 (ADXL345 + ITG3205 + HMC5883)
    MockAccelerometer mockAccel;    // 모의 센서
    bool use_mock_sensor = false;   // 기본값: 실제 센서 사용 (9축 IMU)
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
    
    // 디머 컨트롤러
    DimmerController dimmer;

public:
    void begin() {
        Wire.begin();
        pinMode(BUZZER_PIN, OUTPUT);
        pinMode(LED_PIN, OUTPUT);
        
        // 디머 초기화
        dimmer.begin();
        
        // 센서 모드 초기화
        if (use_mock_sensor) {
            st_debug_print(2, "[SENSOR] Using MOCK accelerometer (for testing)");
        } else {
            st_debug_print(2, "[SENSOR] Using REAL 9-DOF IMU (ADXL345 + ITG3205 + HMC5883)");
            // 자이로 캘리브레이션 (정지 상태에서 1초간)
            delay(1000);
            imu9dof.calibrate_gyro();
        }
        
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
            // 모의 센서 또는 실제 9축 IMU 센서 사용
            sleep_data data;
            if (use_mock_sensor) {
                data = mockAccel.read_sleep_data();
            } else {
                data = imu9dof.read_sleep_data();
#ifdef DEBUG_MEASURE
                data.dump();
#endif
            }
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
        }
        
        // 알람 체크
        if (alarm_active && millis() >= alarm_time) {
            triggerAlarm();
        }
        
        // 디밍 패턴 업데이트
        dimmer.updateDimming();
        
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
        else if (command == "bulb_power") {
            // 전구 전원 켜/끄기
            bool on = doc["on"] | false;
            dimmer.bulbPower(on);
            
            // 서버에 응답 전송
            sendDimmerStatus();
        }
        else if (command == "bulb_dimming") {
            // 디밍 패턴 시작
            uint8_t pattern = doc["pattern"] | 1;
            uint8_t maxBright = doc["maxBright"] | 100;
            dimmer.bulbDimming(pattern, maxBright);
            
            // 서버에 응답 전송
            sendDimmerStatus();
        }
        else if (command == "set_power_clamped") {
            // 밝기 고정 설정
            int level = doc["level"] | MIN_BRIGHT;
            dimmer.setPowerClamped(level);
            
            // 서버에 응답 전송
            sendDimmerStatus();
        }
        else if (command == "set_brightness") {
            // 기존 밝기 설정 (호환성 유지)
            int level = doc["level"] | 0;
            dimmer.setPowerClamped(constrain(level, MIN_BRIGHT, 100));
            
            // 서버에 응답 전송
            sendDimmerStatus();
        }
        else if (command == "sunrise_start") {
            unsigned long duration = doc["duration_ms"] | (15UL * 60UL * 1000UL);
            int target = doc["target_level"] | 100;
            dimmer.startSunrise(duration, constrain(target, 0, 100));
            
            // 서버에 응답 전송
            sendDimmerStatus();
        }
        else if (command == "sunrise_cancel") {
            dimmer.cancelSunrise();
            
            // 서버에 응답 전송
            sendDimmerStatus();
        }
        else if (command == "set_sensor_mode") {
            bool use_mock = doc["use_mock"] | true;
            use_mock_sensor = use_mock;
            char msg[128];
            snprintf(msg, sizeof(msg), "[SENSOR] Mode changed to: %s", use_mock ? "MOCK" : "REAL");
            st_debug_print(2, msg);
        }
        else if (command == "set_mock_movement") {
            bool enable = doc["enable"] | false;
            mockAccel.setMovementSimulation(enable);
        }
        else if (command == "set_mock_noise") {
            float level = doc["level"] | 0.02;
            mockAccel.setNoiseLevel(level);
        }
        else {
            // 알 수 없는 명령
            char msg[128];
            snprintf(msg, sizeof(msg), "[WS] Unknown command: %s", command.c_str());
            st_debug_print(2, msg);
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
        
        // 최근 데이터들을 JSON 배열로 변환 (9축 IMU 데이터)
        for (const auto& data : sleep_buffer) {
            JsonObject data_obj = data_array.createNestedObject();
            // 가속도계 데이터
            data_obj["accel_x"] = data.accel_x;
            data_obj["accel_y"] = data.accel_y;
            data_obj["accel_z"] = data.accel_z;
            // 자이로스코프 데이터
            data_obj["gyro_x"] = data.gyro_x;
            data_obj["gyro_y"] = data.gyro_y;
            data_obj["gyro_z"] = data.gyro_z;
            // 자기계 데이터
            data_obj["mag_x"] = data.mag_x;
            data_obj["mag_y"] = data.mag_y;
            data_obj["mag_z"] = data.mag_z;
            // 자세 정보
            data_obj["roll"] = data.roll;
            data_obj["pitch"] = data.pitch;
            data_obj["yaw"] = data.yaw;
            // 메타데이터
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

    void sendDimmerStatus() {
        DynamicJsonDocument doc(256);
        doc["device_id"] = "ESP32_001";
        doc["status"] = "dimmer_update";
        doc["brightness"] = dimmer.getBrightness();
        doc["pattern_running"] = dimmer.isPatternRunning();
        doc["timestamp"] = millis();
        
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
