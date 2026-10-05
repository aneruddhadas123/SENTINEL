# SENTINEL

SENTINEL is a Congressional App Challenge prototype for proactive, person-centered physiological monitoring. A lightweight ESP32 wristband streams heart-rate and galvanic skin response (GSR) data to a browser over Bluetooth Low Energy. The web app helps an authorized caregiver notice sustained physiological change, review patterns, and consult general support guidance before a situation escalates.

SENTINEL does **not** diagnose distress or predict autistic behavior. Physiological arousal can have many causes. The interface consistently asks caregivers to assess context and follow the individual’s established care and emergency plans.

## Included experiences

- Caregiver overview with current state, trends, checkpoints, and recent events
- Live Web Bluetooth connection to the `PulseGuard` ESP32 wristband
- Smooth demo-data mode for judging when hardware is unavailable
- One-second live visualization with 30-second historical storage
- Personalized five-minute baseline calibration flow
- Tiered event history, CSV export, caregiver roster, and alert routing
- Firebase Authentication and Cloud Firestore integration
- Firebase AI Logic assistant using the **Gemini Developer API** through `GoogleAIBackend` (not Vertex AI)
- Individual wellness portal with calm check-ins, progress, and wristband status
- Browser notifications for newly elevated or crisis-level physiological change
- Anime.js motion for page transitions, live status, charts, metrics, and assistant states
- WebMCP tools for reading current status and opening calibration

## Architecture

```text
MAX30105 + GSR sensor
        │
        ▼
 ESP32 PulseGuard ── BLE ──► Chrome / Edge web app
                                  │
                 ┌────────────────┼────────────────┐
                 ▼                ▼                ▼
          Firebase Auth     Cloud Firestore   Firebase AI Logic
                           30-second samples  Gemini Developer API
```

The app remains functional in local demo mode if Firebase services, App Check, or the wristband are unavailable.

## Firebase setup

The supplied Firebase web configuration is in `lib/firebase.ts`.

1. Open the `congressional-cbb4d` project in Firebase.
2. Enable **Email/Password** under Authentication → Sign-in method.
3. Create Cloud Firestore and deploy `firestore.rules`.
4. Open AI Services → AI Logic, click **Get started**, and select **Gemini Developer API**.
5. Register a reCAPTCHA Enterprise provider under App Check for the web app.
6. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`.
7. Create the first patient document and membership record described below.

Example Firestore membership path:

```text
patients/alex-morgan/members/<firebase-user-uid>
```

Example membership document:

```json
{
  "role": "owner",
  "displayName": "Dr. Sarah Jenkins"
}
```

Firestore rules require this membership before the account can read or append Alex’s telemetry. Until it exists, the app safely retains the latest samples in its local demo buffer.

## Wristband

Flash `hardware/PulseGuard.ino` to an ESP32 with the MAX30105 and GSR sensor connected. The sketch advertises as `PulseGuard` and streams once per second. The web app aggregates the stream and saves one reading every 30 seconds.

The included firmware improves two details from the first prototype:

- Heart rate follows the Bluetooth Heart Rate Measurement packet format.
- GSR is transmitted in hundredths of a microsiemens, preserving two decimal places instead of truncating the value to an integer.

Web Bluetooth requires a user click, a compatible Chromium browser, and a secure HTTPS origin (localhost is permitted for development). If pairing is canceled or unsupported, the demo stream continues automatically.

## Local development

```bash
npm install
npm run dev
```

The app is built with React, TypeScript, Vinext/Next-compatible routing, Tailwind CSS, Shadcn primitives, Anime.js, and the Firebase Web SDK.

## Prototype scoring

`lib/arousal.ts` currently applies a transparent personalized heuristic to changes from the daily heart-rate and GSR baseline. It is intended for interface prototyping and hardware integration only. The research scaffold under `ml/` shows how an offline PyTorch classifier can be trained against ethically appropriate labeled features, but no stress dataset alone validates autism-related crisis prediction.

Before any real-world deployment, SENTINEL would require IRB/ethics review, informed consent or assent, accessibility testing, clinician and caregiver co-design, device validation, privacy review, and evaluation using appropriately annotated data from the intended population.
