#include <Wire.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include "MAX30105.h"
#include "heartRate.h"

// SENTINEL / PulseGuard ESP32 firmware
// Streams once per second for the live UI. The web app stores one aggregate
// sample every 30 seconds to keep the Firestore history compact.

const int GSR_PIN = 32;
const int GSR_SMOOTH_SIZE = 10;
int gsrReadings[GSR_SMOOTH_SIZE];
int gsrIndex = 0;
long gsrTotal = 0;
int baseline = 0;

MAX30105 particleSensor;
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beatAvg = 0;

unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL_MS = 1000;

#define SERVICE_UUID "0000180d-0000-1000-8000-00805f9b34fb"
#define BPM_CHAR_UUID "00002a37-0000-1000-8000-00805f9b34fb"
#define STRESS_CHAR_UUID "00002a06-0000-1000-8000-00805f9b34fb"
#define GSR_CHAR_UUID "12345678-1234-5678-1234-56789abcdef0"

BLECharacteristic *bpmCharacteristic;
BLECharacteristic *stressCharacteristic;
BLECharacteristic *gsrCharacteristic;
bool deviceConnected = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
    Serial.println("SENTINEL browser connected");
  }

  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    BLEDevice::startAdvertising();
    Serial.println("Disconnected; advertising resumed");
  }
};

void setup() {
  Serial.begin(115200);
  Wire.begin();

  Serial.println("Hold still and relax for the 10-second GSR baseline.");
  long total = 0;
  for (int i = 0; i < 100; i++) {
    total += analogRead(GSR_PIN);
    delay(100);
  }
  baseline = total / 100;
  for (int i = 0; i < GSR_SMOOTH_SIZE; i++) {
    gsrReadings[i] = baseline;
    gsrTotal += baseline;
  }

  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30105 not found. Check wiring and power.");
    while (true) delay(1000);
  }
  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);

  BLEDevice::init("PulseGuard");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(BLEUUID(SERVICE_UUID), 30);

  bpmCharacteristic = service->createCharacteristic(
    BPM_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  bpmCharacteristic->addDescriptor(new BLE2902());

  stressCharacteristic = service->createCharacteristic(
    STRESS_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  stressCharacteristic->addDescriptor(new BLE2902());
  stressCharacteristic->setValue("RELAXED");

  gsrCharacteristic = service->createCharacteristic(
    GSR_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  gsrCharacteristic->addDescriptor(new BLE2902());

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("PulseGuard is ready and advertising.");
}

void loop() {
  long irValue = particleSensor.getIR();
  if (checkForBeat(irValue)) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    beatsPerMinute = 60.0 / (delta / 1000.0);
    if (beatsPerMinute > 20 && beatsPerMinute < 255) {
      rates[rateSpot++] = (byte)beatsPerMinute;
      rateSpot %= RATE_SIZE;
      beatAvg = 0;
      for (byte i = 0; i < RATE_SIZE; i++) beatAvg += rates[i];
      beatAvg /= RATE_SIZE;
    }
  }

  unsigned long now = millis();
  if (now - lastPublish < PUBLISH_INTERVAL_MS) return;
  lastPublish = now;

  int rawGsr = analogRead(GSR_PIN);
  gsrTotal -= gsrReadings[gsrIndex];
  gsrReadings[gsrIndex] = rawGsr;
  gsrTotal += rawGsr;
  gsrIndex = (gsrIndex + 1) % GSR_SMOOTH_SIZE;
  int smoothedGsr = gsrTotal / GSR_SMOOTH_SIZE;
  float gsrMicroSiemens = (smoothedGsr / 4095.0) * 20.0;

  int difference = smoothedGsr - baseline;
  int stressScore = constrain(map(abs(difference), 0, 1200, 0, 100), 0, 100);
  const char *arousal = stressScore > 70 ? "HIGH STRESS" : stressScore > 40 ? "MODERATE STRESS" : "RELAXED";
  bool fingerPresent = irValue >= 50000;
  uint8_t bpm = fingerPresent ? (uint8_t)beatAvg : 0;

  Serial.printf("HR %d BPM | GSR %.2f uS | sensor score %d | %s\n", bpm, gsrMicroSiemens, stressScore, arousal);
  if (!deviceConnected) return;

  // Standard Heart Rate Measurement format: flags byte followed by 8-bit BPM.
  uint8_t heartRatePacket[2] = { 0x00, bpm };
  bpmCharacteristic->setValue(heartRatePacket, sizeof(heartRatePacket));
  bpmCharacteristic->notify();

  // Preserve two decimal places as an unsigned 16-bit centi-microsiemens value.
  uint16_t gsrCentiMicroSiemens = (uint16_t)round(gsrMicroSiemens * 100.0);
  gsrCharacteristic->setValue((uint8_t *)&gsrCentiMicroSiemens, sizeof(gsrCentiMicroSiemens));
  gsrCharacteristic->notify();

  stressCharacteristic->setValue(arousal);
  stressCharacteristic->notify();
}
