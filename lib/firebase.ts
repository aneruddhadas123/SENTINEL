import { getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported as analyticsSupported } from "firebase/analytics";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  getDatabase,
  limitToLast,
  onValue,
  orderByChild,
  query as realtimeQuery,
  ref as realtimeRef,
  set as setRealtime,
  update as updateRealtime,
} from "firebase/database";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import type { Baseline, SensorReading } from "@/lib/arousal";

export const firebaseConfig = {
  apiKey: "AIzaSyBgOdqmlqD626d1GbDxaCCSA-CmofgsjV8",
  authDomain: "congressional-cbb4d.firebaseapp.com",
  projectId: "congressional-cbb4d",
  storageBucket: "congressional-cbb4d.firebasestorage.app",
  messagingSenderId: "924270629003",
  appId: "1:924270629003:web:e366a4a21c9dc74f97448e",
  measurementId: "G-Q2BT4KZKN8",
  databaseURL: "https://congressional-cbb4d-default-rtdb.firebaseio.com",
};

export const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const realtimeDb = getDatabase(firebaseApp);

// Initialize Firebase App Check if site key is available
const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
if (typeof window !== "undefined" && appCheckSiteKey) {
  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Hot reload can attempt to initialize App Check more than once.
  }
}

// ── Firebase AI Logic Initializations ─────────────────────────────────────────
const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

// Firebase AI Logic uses the Gemini Developer API configured for this Firebase project.
// Keep every SENTINEL AI experience on the same supported Gemini model.
const GEMINI_MODEL = "gemini-2.5-flash";

// 1. SENTINEL Assistant Model
const careModel = getGenerativeModel(ai, {
  model: GEMINI_MODEL,
  systemInstruction: `You are the SENTINEL wellness assistant. Answer the person's actual question directly in clear, natural language. Do not merely repeat heart-rate or stress-score values. Explain what the available evidence can and cannot suggest, identify whether there is enough history to discuss a trend, and offer one or two low-risk, general support ideas when relevant. Never diagnose, claim to predict a behavioral crisis, or replace clinical judgment. For urgent danger, advise the person to follow their safety plan and contact local emergency services. If there is no live telemetry, say so plainly and answer with general guidance instead of inventing data. Keep answers concise and distinguish observed data from interpretation.`,
});

// 2. Wellness Assessment Model
const patientModel = getGenerativeModel(ai, {
  model: GEMINI_MODEL,
  generationConfig: { responseMimeType: "application/json" },
  systemInstruction: `You are SENTINEL's personal wellness companion for the patient. Your tone is warm, encouraging, gentle, and empowering. 
You are evaluating the patient's real-time physiological signals (Heart Rate and hardware Stress Score) recorded over the last 30 seconds.
Provide:
1. A direct, supportive assessment of how the person is doing right now (1-2 sentences).
2. A status classification: Exactly one of "Calm & Balanced", "Mildly Active", "Elevated Stress", or "Needs Rest".
3. A short, gentle comfort tip or sensory adjustment recommendation (e.g. taking slow breaths, relaxing shoulders, drinking water, taking a quiet moment).

Format your response as a valid JSON object matching this schema:
{
  "feelingState": "Calm & Balanced" | "Mildly Active" | "Elevated Stress" | "Needs Rest",
  "statusSummary": "Your description of how they are doing right now",
  "comfortTip": "One actionable, soothing tip"
}`,
});

// 3. Completed-session Dashboard Insights Model
const dashboardModel = getGenerativeModel(ai, {
  model: GEMINI_MODEL,
  generationConfig: { responseMimeType: "application/json" },
  systemInstruction: `You are the SENTINEL completed-session wellness analyst. Analyze only aggregate information from a completed monitoring session, never present it as current or live data. Give a concise, non-diagnostic retrospective insight. Clearly distinguish observed patterns from interpretation. Do not predict a crisis or replace clinical judgment. Include one low-risk wellness suggestion. Return only valid JSON matching the requested schema.`,
});

if (typeof window !== "undefined") {
  void analyticsSupported()
    .then((supported) => {
      if (supported) getAnalytics(firebaseApp);
    })
    .catch(() => undefined);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type UserRole = "patient" | "caregiver";

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  patientId?: string;
  createdAt?: unknown;
};

export type FirebaseAuthState = User | null;

export type PatientAIAssessment = {
  id: string;
  timestamp: number;
  statusSummary: string;
  feelingState: "Calm & Balanced" | "Mildly Active" | "Elevated Stress" | "Needs Rest";
  comfortTip: string;
  heartRate: number;
  gsr: number;
  score: number;
  stressLevel?: string;
};

export type DashboardInsight = {
  id: string;
  startedAt: number;
  endedAt: number;
  sampleCount: number;
  averageHeartRate: number;
  averageStressScore: number;
  peakStressScore: number;
  calmPercentage: number;
  summary: string;
  pattern: string;
  recommendation: string;
  source: "Google Gemini" | "Session summary";
};

export type RealtimeEvent = {
  id: string;
  date: string;
  time: string;
  severity: "Crisis" | "Elevated" | "Resolved" | "System";
  peak: number;
  duration: string;
  trigger: string;
  recovery: string;
};

// ── Authentication Functions ──────────────────────────────────────────────────

// Resilient promise timeout helper to prevent hanging on Firestore network delays
function timeoutPromise<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  // First check local cache for immediate synchronous rendering
  let cached: UserProfile | null = null;
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(`sentinel_user_profile_${uid}`);
      if (stored) cached = JSON.parse(stored);
    } catch {
      // ignore
    }
  }

  // Attempt to fetch from Firestore with a 1.2s timeout so the UI is never stalled
  try {
    const fetchDoc = getDoc(doc(db, "users", uid));
    const snap = await timeoutPromise(fetchDoc, 1200, null);
    if (snap && snap.exists()) {
      const data = snap.data();
      const profile: UserProfile = {
        uid,
        email: (data.email as string) || cached?.email || auth.currentUser?.email || "",
        displayName:
          (data.displayName as string) ||
          cached?.displayName ||
          auth.currentUser?.displayName ||
          auth.currentUser?.email?.split("@")[0] ||
          "User",
        role: (data.role as UserRole) || cached?.role || "patient",
        patientId: (data.patientId as string) || uid,
        createdAt: data.createdAt,
      };
      if (typeof window !== "undefined") {
        localStorage.setItem(`sentinel_user_profile_${uid}`, JSON.stringify(profile));
      }
      return profile;
    }
  } catch (error) {
    console.warn("Could not fetch user profile from Firestore:", error);
  }

  // Return cached or fallback if user exists
  if (cached) return cached;
  if (auth.currentUser && auth.currentUser.uid === uid) {
    const fallbackProfile: UserProfile = {
      uid,
      email: auth.currentUser.email || "",
      displayName: auth.currentUser.displayName || auth.currentUser.email?.split("@")[0] || "User",
      role: "patient",
      patientId: uid,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(`sentinel_user_profile_${uid}`, JSON.stringify(fallbackProfile));
    }
    return fallbackProfile;
  }

  return null;
}

export function observeAuth(callback: (user: FirebaseAuthState, profile: UserProfile | null) => void) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null, null);
      return;
    }
    const profile = await getUserProfile(user.uid);
    callback(user, profile);
  });
}

export async function registerUser(
  email: string,
  password: string,
  role: UserRole = "patient",
  displayName?: string,
) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const name = displayName?.trim() || email.split("@")[0];

  void sendEmailVerification(credential.user).catch(() => undefined);

  const profile: UserProfile = {
    uid: credential.user.uid,
    email,
    displayName: name,
    role,
    patientId: credential.user.uid,
  };

  if (typeof window !== "undefined") {
    localStorage.setItem(`sentinel_user_profile_${credential.user.uid}`, JSON.stringify(profile));
  }

  try {
    void setDoc(
      doc(db, "users", credential.user.uid),
      {
        email,
        displayName: name,
        role,
        patientId: profile.patientId,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    ).catch((err) => console.warn("Background Firestore user doc creation notice:", err));
  } catch (error) {
    console.warn("Could not save initial user doc in Firestore:", error);
  }

  return { credential, profile };
}

export async function signInUser(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  let profile = await getUserProfile(credential.user.uid);
  if (!profile) {
    profile = {
      uid: credential.user.uid,
      email: credential.user.email || email,
      displayName: credential.user.displayName || email.split("@")[0] || "User",
      role: "patient",
      patientId: credential.user.uid,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(`sentinel_user_profile_${credential.user.uid}`, JSON.stringify(profile));
    }
  }
  return { credential, profile };
}

export async function signInDemoGuest(role: UserRole = "patient", displayName = "Demo User") {
  try {
    const credential = await signInAnonymously(auth);
    const profile: UserProfile = {
      uid: credential.user.uid,
      email: `${role}-demo@sentinel.org`,
      displayName,
      role,
      patientId: credential.user.uid,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(`sentinel_user_profile_${credential.user.uid}`, JSON.stringify(profile));
    }
    return { credential, profile };
  } catch {
    // If anonymous sign-in isn't enabled in console, construct mock session
    const mockUid = `demo-${Date.now()}`;
    const profile: UserProfile = {
      uid: mockUid,
      email: `${role}-demo@sentinel.org`,
      displayName,
      role,
      patientId: mockUid,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(`sentinel_user_profile_${mockUid}`, JSON.stringify(profile));
    }
    return { credential: null, profile };
  }
}

export async function signOutUser() {
  if (typeof window !== "undefined" && auth.currentUser) {
    localStorage.removeItem(`sentinel_user_profile_${auth.currentUser.uid}`);
  }
  return signOut(auth);
}

export async function resetUserPassword(email: string) {
  return sendPasswordResetEmail(auth, email);
}

// Backwards compatibility aliases
export const signInCaregiver = (email: string, password: string) => signInUser(email, password);
export const registerCaregiver = (email: string, password: string) => registerUser(email, password, "caregiver");
export const signOutCaregiver = signOutUser;

// ── Firestore Telemetry & Calibration ─────────────────────────────────────────

export async function saveTelemetrySample(reading: SensorReading, patientId?: string) {
  if (!auth.currentUser) throw new Error("Sign in to sync telemetry with Firestore.");
  const pid = patientId || auth.currentUser.uid;
  return addDoc(collection(db, "patients", pid, "telemetry"), {
    heartRate: reading.heartRate,
    gsr: reading.gsr,
    arousalScore: reading.score,
    state: reading.state,
    source: reading.source,
    stressLevel: reading.stressLevel || "RELAXED",
    deviceCapturedAt: new Date(reading.capturedAt),
    storedAt: serverTimestamp(),
    storedBy: auth.currentUser.uid,
  });
}

// ── Realtime Database history ────────────────────────────────────────────────
// Data is stored beneath the signed-in user's account, never in a shared path.
function realtimeAccountId(uid?: string) {
  const resolved = uid || auth.currentUser?.uid;
  if (!resolved) throw new Error("Sign in to save wellness history.");
  return resolved;
}

function serializeRealtimeReading(reading: SensorReading) {
  return {
    heartRate: Number(reading.heartRate) || 0,
    gsr: Number(reading.gsr) || 0,
    score: Number(reading.score ?? reading.stressScore) || 0,
    stressScore: Number(reading.stressScore ?? reading.score) || 0,
    state: reading.state || "calm",
    stressLevel: reading.stressLevel || "RELAXED",
    source: reading.source || "bluetooth",
    capturedAt: Number(reading.capturedAt) || Date.now(),
  };
}

export async function saveRealtimeTelemetrySample(reading: SensorReading, uid?: string) {
  const accountId = realtimeAccountId(uid);
  const readingId = reading.id || `read-${reading.capturedAt || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return setRealtime(
    realtimeRef(realtimeDb, `accounts/${accountId}/telemetry/${readingId}`),
    serializeRealtimeReading({ ...reading, id: readingId }),
  );
}

export async function saveRealtimeTelemetrySamples(readings: SensorReading[], uid?: string) {
  if (!readings.length) return;
  const accountId = realtimeAccountId(uid);
  const updates: Record<string, ReturnType<typeof serializeRealtimeReading>> = {};
  for (const reading of readings) {
    const readingId = reading.id || `read-${reading.capturedAt || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    updates[readingId] = serializeRealtimeReading({ ...reading, id: readingId });
  }
  return updateRealtime(realtimeRef(realtimeDb, `accounts/${accountId}/telemetry`), updates);
}

export async function saveRealtimeEvent(event: RealtimeEvent, uid?: string) {
  const accountId = realtimeAccountId(uid);
  const eventId = event.id || `EVT-${Date.now()}`;
  return setRealtime(realtimeRef(realtimeDb, `accounts/${accountId}/events/${eventId}`), {
    ...event,
    id: eventId,
    severity: event.severity || "System",
  });
}

export function subscribeToRealtimeTelemetry(
  callback: (readings: SensorReading[]) => void,
  onError?: (err: Error) => void,
  uid?: string,
) {
  try {
    const accountId = realtimeAccountId(uid);
    const telemetryQuery = realtimeQuery(
      realtimeRef(realtimeDb, `accounts/${accountId}/telemetry`),
      orderByChild("capturedAt"),
      limitToLast(2_000),
    );
    return onValue(
      telemetryQuery,
      (snapshot) => {
        try {
          const data = (snapshot.val() || {}) as Record<string, Record<string, unknown>>;
          const readings = Object.entries(data)
            .map(([id, value]) => ({
              id,
              capturedAt: Number(value.capturedAt) || 0,
              heartRate: Number(value.heartRate) || 0,
              gsr: Number(value.gsr) || 0,
              score: Number(value.score ?? value.stressScore) || 0,
              stressScore: Number(value.stressScore ?? value.score) || 0,
              state: value.state === "crisis" || value.state === "elevated" ? value.state : "calm",
              stressLevel: typeof value.stressLevel === "string" ? value.stressLevel : "RELAXED",
              source: value.source === "demo" ? "demo" : "bluetooth",
            } satisfies SensorReading))
            .filter((reading) => reading.capturedAt > 0)
            .sort((a, b) => a.capturedAt - b.capturedAt);
          callback(readings);
        } catch (e) {
          onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      },
      (error) => {
        console.warn("RTDB telemetry listener error:", error);
        onError?.(error);
      },
    );
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    return () => {};
  }
}

export function subscribeToRealtimeEvents(
  callback: (events: RealtimeEvent[]) => void,
  onError?: (err: Error) => void,
  uid?: string,
) {
  try {
    const accountId = realtimeAccountId(uid);
    return onValue(
      realtimeRef(realtimeDb, `accounts/${accountId}/events`),
      (snapshot) => {
        try {
          const data = (snapshot.val() || {}) as Record<string, Partial<RealtimeEvent>>;
          const events = Object.entries(data)
            .map(([id, value]) => ({
              id,
              date: String(value.date || ""),
              time: String(value.time || ""),
              severity: value.severity === "Crisis" || value.severity === "Elevated" || value.severity === "Resolved" ? value.severity : "System",
              peak: Number(value.peak) || 0,
              duration: String(value.duration || "—"),
              trigger: String(value.trigger || "Recorded event"),
              recovery: String(value.recovery || "—"),
            } satisfies RealtimeEvent))
            .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
          callback(events);
        } catch (e) {
          onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      },
      (error) => {
        console.warn("RTDB events listener error:", error);
        onError?.(error);
      },
    );
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    return () => {};
  }
}

export function subscribeToRealtimeConnection(callback: (connected: boolean) => void) {
  try {
    const connectedRef = realtimeRef(realtimeDb, ".info/connected");
    return onValue(
      connectedRef,
      (snap) => {
        callback(Boolean(snap.val()));
      },
      () => {
        callback(false);
      },
    );
  } catch {
    return () => {};
  }
}

export async function saveCalibration(baseline: Baseline, patientId?: string) {
  if (!auth.currentUser) throw new Error("Sign in to sync calibration with Firestore.");
  const pid = patientId || auth.currentUser.uid;
  return setDoc(doc(db, "patients", pid, "calibrations", String(baseline.calibratedAt)), {
    heartRate: baseline.heartRate,
    gsr: baseline.gsr,
    calibratedAt: new Date(baseline.calibratedAt),
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid,
  });
}

// ── Firebase AI Logic Functions ───────────────────────────────────────────────

/**
 * 30-Second Automated Patient AI Assessment.
 * Generates an empathetic, patient-tailored overview of current physiological signals.
 */
export async function generatePatientStatusAssessment(context: {
  heartRate: number;
  stressScore: number;
  score: number;
  state: string;
  stressLevel?: string;
  recentTrend?: string;
}): Promise<PatientAIAssessment> {
  const prompt = `Current 30-second patient telemetry:
- Heart Rate: ${context.heartRate} BPM
- Hardware Stress Score: ${context.stressScore}/100
- Arousal State: ${context.state}
- ESP32 Hardware Stress State: ${context.stressLevel || "RELAXED"}
- Recent 30-sec trend: ${context.recentTrend || "Stable baseline"}

Generate the JSON status assessment for the patient right now.`;

  const fallback: PatientAIAssessment = {
    id: `ai-eval-${Date.now()}`,
    timestamp: Date.now(),
    feelingState: context.score >= 80 ? "Elevated Stress" : context.score >= 60 ? "Mildly Active" : "Calm & Balanced",
    statusSummary: context.score < 60
      ? `Your hardware stress score is ${context.stressScore}/100 and your heart rate is ${context.heartRate} BPM. Your current state appears steady.`
      : `Your signals show a slight elevation (${context.heartRate} BPM, ${context.stressLevel || "Active"}). Your body is responding to sensory activity.`,
    comfortTip: context.score < 60
      ? "Great moment to stay in your flow, listen to relaxing music, or enjoy your current activity."
      : "Try taking 3 slow, deep belly breaths and relax your shoulders.",
    heartRate: context.heartRate,
    gsr: 0,
    score: context.score,
    stressLevel: context.stressLevel,
  };

  try {
    const result = await patientModel.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        id: `ai-eval-${Date.now()}`,
        timestamp: Date.now(),
        feelingState: parsed.feelingState || fallback.feelingState,
        statusSummary: parsed.statusSummary || fallback.statusSummary,
        comfortTip: parsed.comfortTip || fallback.comfortTip,
        heartRate: context.heartRate,
        gsr: 0,
        score: context.score,
        stressLevel: context.stressLevel,
      };
    }
  } catch (err) {
    console.info("Firebase AI Logic used graceful patient fallback:", err);
  }

  return fallback;
}

/**
 * Save a 30-second AI assessment to Firestore for patient records.
 */
export async function savePatientAIAssessment(
  assessment: PatientAIAssessment,
  patientId?: string,
) {
  if (!auth.currentUser) return;
  const pid = patientId || auth.currentUser.uid;
  try {
    return await addDoc(collection(db, "patients", pid, "aiAssessments"), {
      feelingState: assessment.feelingState,
      statusSummary: assessment.statusSummary,
      comfortTip: assessment.comfortTip,
      heartRate: assessment.heartRate,
      gsr: assessment.gsr,
      score: assessment.score,
      stressLevel: assessment.stressLevel || "RELAXED",
      assessedAt: new Date(assessment.timestamp),
      createdAt: serverTimestamp(),
      userId: auth.currentUser.uid,
    });
  } catch (e) {
    console.warn("Could not save AI assessment to Firestore:", e);
  }
}

export async function generateDashboardSessionInsight(context: {
  sampleCount: number;
  durationMinutes: number;
  averageHeartRate: number;
  averageStressScore: number;
  peakStressScore: number;
  calmPercentage: number;
  trend: "increased" | "decreased" | "steady";
}) {
  const prompt = `Completed monitoring session summary (not live telemetry):
- Samples recorded: ${context.sampleCount}
- Session duration: ${context.durationMinutes} minutes
- Average heart rate: ${context.averageHeartRate} BPM
- Average stress score: ${context.averageStressScore}/100
- Peak stress score: ${context.peakStressScore}/100
- Time in calm range: ${context.calmPercentage}%
- Session trend: stress ${context.trend}

Return this exact JSON shape:
{
  "summary": "One or two concise sentences describing the completed session, without claiming these readings are current.",
  "pattern": "A short retrospective pattern label.",
  "recommendation": "One gentle, low-risk wellness suggestion."
}`;

  const result = await dashboardModel.generateContent(prompt);
  const text = result.response.text().trim();
  const parsed = JSON.parse(text) as Partial<Pick<DashboardInsight, "summary" | "pattern" | "recommendation">>;
  if (!parsed.summary || !parsed.pattern || !parsed.recommendation) {
    throw new Error("Gemini returned an incomplete session insight.");
  }
  return {
    summary: parsed.summary,
    pattern: parsed.pattern,
    recommendation: parsed.recommendation,
  };
}

export async function saveDashboardInsight(insight: DashboardInsight, patientId?: string) {
  if (!auth.currentUser) return;
  const pid = patientId || auth.currentUser.uid;
  try {
    await addDoc(collection(db, "patients", pid, "sessionInsights"), {
      ...insight,
      startedAt: new Date(insight.startedAt),
      endedAt: new Date(insight.endedAt),
      createdAt: serverTimestamp(),
      userId: auth.currentUser.uid,
    });
  } catch (error) {
    console.warn("Could not save dashboard insight to Firestore:", error);
  }
}

export async function loadDashboardInsights(patientId?: string): Promise<DashboardInsight[]> {
  if (!auth.currentUser) return [];
  const pid = patientId || auth.currentUser.uid;
  try {
    const snapshots = await getDocs(query(collection(db, "patients", pid, "sessionInsights"), orderBy("endedAt", "desc"), limit(24)));
    return snapshots.docs.map((snapshot) => {
      const data = snapshot.data();
      const toMillis = (value: unknown) => {
        if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
          return (value as { toMillis: () => number }).toMillis();
        }
        return typeof value === "number" ? value : Date.now();
      };
      return {
        id: String(data.id || snapshot.id),
        startedAt: toMillis(data.startedAt),
        endedAt: toMillis(data.endedAt),
        sampleCount: Number(data.sampleCount) || 0,
        averageHeartRate: Number(data.averageHeartRate) || 0,
        averageStressScore: Number(data.averageStressScore) || 0,
        peakStressScore: Number(data.peakStressScore) || 0,
        calmPercentage: Number(data.calmPercentage) || 0,
        summary: String(data.summary || "Completed monitoring session."),
        pattern: String(data.pattern || "Session recorded"),
        recommendation: String(data.recommendation || "Review this session alongside your usual wellness routine."),
        source: data.source === "Google Gemini" ? "Google Gemini" : "Session summary",
      };
    });
  } catch (error) {
    console.warn("Could not load dashboard insights from Firestore:", error);
    return [];
  }
}

/**
 * Interactive Caregiver Clinical Assistant query.
 */
export async function askCareAssistant(question: string, context: string) {
  const prompt = `Current SENTINEL context:\n${context}\n\nCaregiver question: ${question}\n\nAnswer the question itself first. Use the telemetry only as supporting context; do not respond with a bare list of current sensor values.`;
  const result = await careModel.generateContent(prompt);
  const response = result.response.text().trim();
  if (!response) throw new Error("The assistant returned an empty response.");
  return response;
}
