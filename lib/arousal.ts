export type ArousalState = "calm" | "elevated" | "crisis";

export type SensorReading = {
  id: string;
  capturedAt: number;
  heartRate: number;
  gsr: number;
  score: number;
  stressScore: number;
  state: ArousalState;
  source: "demo" | "bluetooth";
  stressLevel?: string; // "RELAXED" | "MODERATE STRESS" | "HIGH STRESS" from ESP32 BLE
};

export type Baseline = {
  heartRate: number;
  gsr: number;
  calibratedAt: number;
  /** True after a live GSR value or an explicit calibration establishes the sensor reference. */
  gsrInitialized?: boolean;
};

export const DEFAULT_BASELINE: Baseline = {
  heartRate: 72,
  gsr: 1.05,
  calibratedAt: Date.UTC(2026, 8, 12, 12, 3),
  gsrInitialized: false,
};

/**
 * Establish and gently track the GSR reference independently from heart rate.
 * GSR is highly person- and sensor-dependent, so its absolute value is not a
 * useful stress signal until it has been compared with this device's baseline.
 */
export function updateGsrBaseline(baseline: Baseline, gsr: number): Baseline {
  if (!Number.isFinite(gsr) || gsr <= 0) return baseline;

  if (!baseline.gsrInitialized) {
    return { ...baseline, gsr, gsrInitialized: true, calibratedAt: Date.now() };
  }

  const relativeChange = Math.abs(gsr - baseline.gsr) / Math.max(0.05, baseline.gsr);
  // Only follow small, sustained shifts. Large changes remain deviations from
  // baseline instead of being absorbed as the new normal immediately.
  if (relativeChange > 0.2) return baseline;

  const smoothedGsr = baseline.gsr * 0.995 + gsr * 0.005;
  return { ...baseline, gsr: smoothedGsr };
}

export function classifyArousal(score: number): ArousalState {
  if (score >= 80) return "crisis";
  if (score >= 60) return "elevated";
  return "calm";
}
export function calculateArousalScore(
  heartRate: number,
  gsr: number,
  baseline: Baseline = DEFAULT_BASELINE,
) {
  const hrDelta = Math.max(0, (heartRate - baseline.heartRate) / Math.max(1, baseline.heartRate));
  const gsrDelta = Math.max(0, (gsr - baseline.gsr) / Math.max(0.05, baseline.gsr));
  const physiologicalChange = hrDelta * 42 + gsrDelta * 58;
  return Math.max(8, Math.min(100, Math.round(24 + physiologicalChange * 72)));
}

export function createReading(
  heartRate: number,
  gsr: number,
  source: SensorReading["source"],
  baseline: Baseline = DEFAULT_BASELINE,
  stressLevel?: string,
): SensorReading {
  const score = calculateArousalScore(heartRate, gsr, baseline);
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    capturedAt: Date.now(),
    heartRate: Math.round(heartRate),
    gsr: Math.round(gsr * 100) / 100,
    score,
    stressScore: score,
    state: classifyArousal(score),
    source,
    stressLevel: stressLevel ?? (score >= 80 ? "HIGH STRESS" : score >= 60 ? "MODERATE STRESS" : "RELAXED"),
  };
}

export function stressScoreFromLevel(stressLevel?: string): number {
  const normalized = stressLevel?.trim().toUpperCase() ?? "";
  if (normalized.includes("HIGH")) return 90;
  if (normalized.includes("MODERATE")) return 60;
  return 20;
}

export function createHardwareReading(
  heartRate: number,
  stressLevel: string,
  source: SensorReading["source"],
): SensorReading {
  const stressScore = stressScoreFromLevel(stressLevel);
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    capturedAt: Date.now(),
    heartRate: Math.round(heartRate),
    // Kept as a compatibility placeholder for existing storage records. The
    // new firmware does not transmit a GSR measurement to the website.
    gsr: 0,
    score: stressScore,
    stressScore,
    state: classifyArousal(stressScore),
    source,
    stressLevel,
  };
}

export function initialReadings(): SensorReading[] {
  const heartRates = [71, 70, 72, 69, 73, 72, 75, 74, 72, 70, 68, 69, 71, 70, 68, 67, 69, 68, 67, 68, 69, 68, 67, 68];
  const gsrValues = [1.05, 1.08, 1.02, 1.12, 1.09, 1.18, 1.15, 1.11, 1.07, 1.02, 0.98, 1.0, 1.03, 1.01, 0.96, 0.94, 0.98, 0.97, 0.95, 0.96, 0.99, 0.98, 0.96, 0.97];
  const start = Date.now() - heartRates.length * 30_000;
  return heartRates.map((heartRate, index) => {
    const score = Math.max(22, Math.min(58, 40 + Math.round((heartRate - 70) * 2 + (gsrValues[index] - 1) * 38)));
    return {
      id: `seed-${index}`,
      capturedAt: start + index * 30_000,
      heartRate,
      gsr: gsrValues[index],
      score,
      stressScore: score,
      state: classifyArousal(score),
      source: "demo",
    };
  });
}

export function stateLabel(state: ArousalState) {
  return state === "calm" ? "Calm" : state === "elevated" ? "Elevated" : "Crisis";
}
