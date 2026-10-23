"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { animate, createScope, stagger } from "animejs";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bell,
  Bluetooth,
  BluetoothOff,
  Bot,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  Clock3,
  Download,
  HeartPulse,
  LayoutDashboard,
  Lightbulb,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  MoonStar,
  MoreHorizontal,
  Play,
  Radio,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  UserCheck,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import type { User } from "firebase/auth";
import {
  createHardwareReading,
  stateLabel,
  type ArousalState,
  type SensorReading,
} from "@/lib/arousal";
import {
  connectPulseGuard,
  supportsWebBluetooth,
  type PulseGuardConnection,
  type PulseGuardSnapshot,
} from "@/lib/bluetooth";
import type { DashboardInsight, PatientAIAssessment, RealtimeEvent, UserProfile, UserRole } from "@/lib/firebase";

// ── Navigation types ──────────────────────────────────────────────────────────
type PortalView = "overview" | "live" | "insights" | "events" | "settings";
type PortalMode = "landing" | "portal";
type FirebaseAuthState = User | null;
type Message = { id: string; role: "assistant" | "user"; text: string };
type EventRecord = RealtimeEvent;
type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

const navigation: Array<{ id: PortalView; label: string; icon: IconType }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "live", label: "Live Monitoring", icon: Activity },
  { id: "insights", label: "AI Insights", icon: BrainCircuit },
  { id: "events", label: "Events", icon: CalendarClock },
  { id: "settings", label: "Settings", icon: Settings },
];

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    text: "I'm your SENTINEL wellness assistant. Connect your monitoring device and I can help you understand your physiological patterns, explain changes from baseline, or suggest general support strategies.",
  },
];

const quickPrompts = [
  "Is the current baseline stable?",
  "Summarize the last 12 hours.",
  "Suggest general de-escalation steps.",
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(timestamp);
}

function formatSessionDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

function formatSessionDuration(durationMs: number) {
  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${totalMinutes % 60}m`;
}

function createSessionSummary(readings: SensorReading[], startedAt: number, endedAt = Date.now()): DashboardInsight | null {
  if (!readings.length) return null;
  const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const averageHeartRate = average(readings.map((reading) => reading.heartRate));
  const averageStressScore = average(readings.map((reading) => reading.stressScore));
  const peakStressScore = Math.max(...readings.map((reading) => reading.stressScore));
  const calmPercentage = Math.round((readings.filter((reading) => reading.state === "calm").length / readings.length) * 100);
  const windowSize = Math.max(1, Math.ceil(readings.length / 3));
  const openingAverage = average(readings.slice(0, windowSize).map((reading) => reading.stressScore));
  const closingAverage = average(readings.slice(-windowSize).map((reading) => reading.stressScore));
  const trend = closingAverage - openingAverage;
  const pattern = trend <= -8 ? "Stress eased across the session" : trend >= 8 ? "Stress rose across the session" : "Stress remained fairly steady";
  return {
    id: `session-${endedAt}`,
    startedAt,
    endedAt,
    sampleCount: readings.length,
    averageHeartRate,
    averageStressScore,
    peakStressScore,
    calmPercentage,
    summary: `This completed session averaged ${averageStressScore}/100 for stress, with ${calmPercentage}% of readings in the calm range.`,
    pattern,
    recommendation: "Use this completed session as a gentle reference point alongside your usual wellness routine.",
    source: "Session summary",
  };
}

function eventStyles(severity: EventRecord["severity"]) {
  if (severity === "Crisis") return "bg-rose-50 text-rose-700";
  if (severity === "Elevated") return "bg-amber-50 text-amber-700";
  if (severity === "Resolved") return "bg-[#e7f8f5] text-[#087067]";
  return "bg-slate-100 text-slate-600";
}

// ── Shared UI Components ──────────────────────────────────────────────────────
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("anime-panel rounded-[20px] border border-sentinel-line bg-white shadow-[0_18px_48px_rgba(20,44,52,.055)]", className)}>
      {children}
    </section>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="anime-panel mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-sentinel-teal">
          <span className="size-2 rounded-full bg-sentinel-teal shadow-[0_0_0_5px_rgba(12,148,136,.12)]" />
          {eyebrow}
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-[-.04em] sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-sentinel-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
  icon: Icon,
  tone = "teal",
}: {
  label: string;
  value: string | number;
  unit?: string;
  note: string;
  icon: IconType;
  tone?: "teal" | "rose" | "amber" | "blue";
}) {
  const toneClass = {
    teal: "bg-sentinel-soft text-sentinel-teal",
    rose: "bg-rose-50 text-rose-500",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
  }[tone];
  return (
    <Panel className="anime-metric p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-sentinel-muted">{label}</p>
          <p className="mt-2 font-display text-3xl font-extrabold tracking-[-.04em]">
            {value} {unit && <span className="text-sm font-bold text-sentinel-muted">{unit}</span>}
          </p>
          <p className="mt-2 text-xs text-sentinel-muted">{note}</p>
        </div>
        <span className={cn("grid size-10 place-items-center rounded-xl", toneClass)}>
          <Icon className="size-5" />
        </span>
      </div>
    </Panel>
  );
}

function Sparkline({ values, color, id, height = 112 }: { values: number[]; color: string; id: string; height?: number }) {
  const width = 420;
  const min = Math.min(...values) - 2;
  const max = Math.max(...values) + 2;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / Math.max(1, max - min)) * (height - 16) - 8;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label="Sensor trend over recent readings">
      <defs>
        <linearGradient id={`gradient-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0 ${height * 0.25}H${width}M0 ${height * 0.6}H${width}M0 ${height - 1}H${width}`} stroke="#e7edf0" strokeWidth="1" />
      <polygon points={`${points} ${width},${height} 0,${height}`} fill={`url(#gradient-${id})`} />
      <polyline className="anime-line" points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-xl bg-sentinel-teal text-white shadow-[0_8px_20px_rgba(8,112,103,.2)]">
        <ShieldCheck className="size-5" />
      </div>
      {!compact && (
        <div>
          <p className="font-display text-lg font-extrabold tracking-[-.02em] text-sentinel-teal-dark">SENTINEL</p>
          <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-sentinel-muted">Care & Wellness</p>
        </div>
      )}
    </div>
  );
}

// ── Device Status Bar ─────────────────────────────────────────────────────────
function DeviceBar({
  connected,
  monitoring,
  storageStatus,
  stressLevel,
  onConnect,
  onToggleMonitoring,
}: {
  connected: boolean;
  monitoring: boolean;
  storageStatus: string;
  stressLevel?: string;
  onConnect: () => void;
  onToggleMonitoring: () => void;
}) {
  return (
    <Panel className="mb-5 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative grid size-11 place-items-center rounded-xl bg-sentinel-soft text-sentinel-teal">
            <span className={cn("live-dot absolute inset-1 rounded-lg border border-sentinel-teal/20", !connected && "hidden")} />
            {connected ? <Bluetooth className="relative size-5" /> : <BluetoothOff className="relative size-5 text-slate-400" />}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold">
                {connected ? "Monitoring Device Connected" : "No Device Connected"}
              </p>
              {connected && stressLevel && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold tracking-wide uppercase text-slate-700">
                  {stressLevel}
                </span>
              )}
            </div>
            <p className="text-xs text-sentinel-muted">
              {connected ? storageStatus + " · Heart Rate & Stress Score" : "Pair a device to begin live monitoring"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected && (
            <span className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold",
              monitoring ? "border-[#c9eee8] bg-[#e7f8f5] text-[#087067]" : "border-slate-200 bg-slate-50 text-slate-600",
            )}>
              <span className={cn("size-2 rounded-full", monitoring ? "bg-sentinel-teal animate-pulse" : "bg-slate-400")} />
              {monitoring ? "Monitoring Active" : "Monitoring Paused"}
            </span>
          )}
          {connected && (
            <Button
              variant="outline"
              size="sm"
              className={cn("rounded-lg border-sentinel-line", monitoring ? "text-rose-600 hover:bg-rose-50 hover:border-rose-200" : "text-sentinel-teal hover:bg-sentinel-soft")}
              onClick={onToggleMonitoring}
            >
              {monitoring ? <><Square className="size-3.5" /> Stop Monitoring</> : <><Play className="size-3.5" /> Start Monitoring</>}
            </Button>
          )}
          <Button size="sm" className="rounded-lg bg-sentinel-teal hover:bg-sentinel-teal-dark" onClick={onConnect}>
            <Bluetooth className="size-3.5" /> {connected ? "Reconnect Device" : "Pair Device"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ── Overview View ─────────────────────────────────────────────────────────────
function OverviewView({
  events,
  insights,
  historicalReadings,
  activeSessionStartedAt,
  onNavigate,
}: {
  events: EventRecord[];
  insights: DashboardInsight[];
  historicalReadings: SensorReading[];
  activeSessionStartedAt: number | null;
  onNavigate: (view: PortalView) => void;
}) {
  // Overview deliberately excludes an active session. Current metrics remain
  // exclusive to Live Monitoring, while these graphs stay historical.
  const completedReadings = activeSessionStartedAt
    ? historicalReadings.filter((reading) => reading.capturedAt < activeSessionStartedAt)
    : historicalReadings;
  const historyAverage = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
  const sessionCount = insights.length;
  const averageHeartRate = completedReadings.length ? historyAverage(completedReadings.map((reading) => reading.heartRate)) : 0;
  const averageStress = completedReadings.length ? historyAverage(completedReadings.map((reading) => reading.stressScore)) : 0;
  const peakStress = completedReadings.length ? Math.max(...completedReadings.map((reading) => reading.stressScore)) : 0;
  const monitoredMs = insights.reduce((sum, insight) => sum + Math.max(0, insight.endedAt - insight.startedAt), 0);
  const latestInsight = insights[0];
  return (
    <>
      <PageHeading
        eyebrow="Completed session history"
        title="Your Wellness Dashboard"
        description="Review completed monitoring sessions over time. Current physiological metrics are shown only in Live Monitoring."
        action={
          <Button className="rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark" onClick={() => onNavigate("live")}>
            <Radio /> Open Live View
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Completed sessions" value={sessionCount} note={sessionCount ? "Saved monitoring sessions" : "Stop a session to create history"} icon={CalendarClock} />
        <Metric label="Average heart rate" value={completedReadings.length ? averageHeartRate : "—"} unit={completedReadings.length ? "BPM" : undefined} note="Stored history, not current" icon={HeartPulse} tone="rose" />
        <Metric label="Average stress score" value={completedReadings.length ? averageStress : "—"} unit={completedReadings.length ? "/ 100" : undefined} note="Stored history, not current" icon={Activity} tone="teal" />
        <Metric label="Highest recorded stress" value={completedReadings.length ? peakStress : "—"} unit={completedReadings.length ? "/ 100" : undefined} note="Historical peak, not current" icon={Activity} tone="amber" />
        <Metric label="Time monitored" value={sessionCount ? formatSessionDuration(monitoredMs) : "—"} note="Across completed sessions" icon={Clock3} tone="blue" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel className="p-6 sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-sentinel-muted">Heart-rate history</p>
              <h2 className="mt-1 font-display text-xl font-extrabold">Changes over completed sessions</h2>
            </div>
            <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600">Historical</span>
          </div>
          <div className="mt-7">
            {completedReadings.length > 1 ? (
              <Sparkline id="overview-heart" values={completedReadings.map((reading) => reading.heartRate)} color="#eb5b69" height={150} />
            ) : (
              <div className="flex h-[150px] items-center justify-center rounded-2xl bg-slate-50">
                <p className="text-sm text-sentinel-muted">Complete a session to add heart-rate history</p>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-sentinel-muted">Earlier readings <span className="float-right">Most recent completed reading</span></p>
        </Panel>
        <Panel className="p-6 sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-sentinel-muted">Stress-score history</p>
              <h2 className="mt-1 font-display text-xl font-extrabold">Changes over completed sessions</h2>
            </div>
            <span className="rounded-full bg-sentinel-soft px-3 py-1.5 text-xs font-bold text-sentinel-teal">Historical</span>
          </div>
          <div className="mt-7">
            {completedReadings.length > 1 ? (
              <Sparkline id="overview-stress" values={completedReadings.map((reading) => reading.stressScore)} color="#0c9488" height={150} />
            ) : (
              <div className="flex h-[150px] items-center justify-center rounded-2xl bg-slate-50">
                <p className="text-sm text-sentinel-muted">Complete a session to add stress-score history</p>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-sentinel-muted">Earlier readings <span className="float-right">Most recent completed reading</span></p>
        </Panel>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
        <Panel className="p-6 sm:p-7">
          <p className="text-sm font-semibold text-sentinel-muted">Historical monitoring time</p>
          <p className="mt-2 font-display text-4xl font-extrabold tracking-[-.04em]">{sessionCount ? formatSessionDuration(monitoredMs) : "—"}</p>
          <p className="mt-2 text-sm text-sentinel-muted">Across {sessionCount || "no"} completed monitoring session{sessionCount === 1 ? "" : "s"}.</p>
        </Panel>
        <Panel className="overflow-hidden">
          <div className="border-b border-sentinel-line p-6">
            <p className="text-sm font-semibold text-sentinel-muted">Latest completed insight</p>
            <h2 className="mt-1 font-display text-xl font-extrabold">{latestInsight?.pattern || "Session insights"}</h2>
          </div>
          <div className="space-y-1 p-3">
            {latestInsight ? (
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm leading-5 text-sentinel-muted">{latestInsight.summary}</p>
                <p className="mt-3 border-t border-sentinel-line pt-3 text-sm font-medium leading-5 text-sentinel-ink">{latestInsight.recommendation}</p>
                <p className="mt-3 text-xs font-bold text-sentinel-teal">{formatSessionDate(latestInsight.endedAt)} · {latestInsight.source}</p>
              </div>
            ) : <div className="rounded-xl bg-slate-50 p-4 text-sm text-sentinel-muted">Completed-session insights will appear here after monitoring stops.</div>}
          </div>
        </Panel>
      </div>
      <Panel className="mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-sentinel-line p-5 sm:px-6">
          <div>
            <p className="font-display text-lg font-extrabold">Recent activity</p>
            <p className="text-xs text-sentinel-muted">Latest state changes and interventions</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("events")}>
            View all <ArrowRight />
          </Button>
        </div>
        <EventTable events={events.slice(0, 3)} compact />
      </Panel>
    </>
  );
}

// ── Live View ─────────────────────────────────────────────────────────────────
function LiveView({
  latest,
  readings,
  connected,
  monitoring,
  storageStatus,
  stressLevel,
  onConnect,
  onToggleMonitoring,
}: {
  latest: SensorReading;
  readings: SensorReading[];
  connected: boolean;
  monitoring: boolean;
  storageStatus: string;
  stressLevel?: string;
  onConnect: () => void;
  onToggleMonitoring: () => void;
}) {
  return (
    <>
      <PageHeading
        eyebrow="Live telemetry"
        title={
          !connected ? "No Device Connected" :
          !monitoring ? "Monitoring Paused" :
          latest.state === "calm" ? "Steady Physiological State" :
          latest.state === "elevated" ? "Arousal is Elevated" :
          "Crisis Threshold Reached"
        }
        description={
          !connected
            ? "Pair your monitoring device to begin streaming physiological data in real time."
            : !monitoring
            ? "Monitoring is paused. Press Start Monitoring to resume data collection."
            : latest.state === "calm"
            ? "Physiological signals are within your personalized baseline range."
            : "SENTINEL detected a sustained change. Check your comfort and follow your established care plan."
        }
      />
      <DeviceBar
        connected={connected}
        monitoring={monitoring}
        storageStatus={storageStatus}
        stressLevel={stressLevel}
        onConnect={onConnect}
        onToggleMonitoring={onToggleMonitoring}
      />

      {!connected ? (
        <Panel className="p-12 text-center">
          <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-slate-100 text-slate-400">
            <BluetoothOff className="size-8" />
          </span>
          <h2 className="font-display text-xl font-extrabold">Device Not Connected</h2>
          <p className="mt-2 text-sm text-sentinel-muted max-w-sm mx-auto">
            Pair your monitoring device using the button above to begin receiving live physiological data.
          </p>
          <Button className="mt-6 rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark" onClick={onConnect}>
            <Bluetooth className="size-4" /> Pair Device
          </Button>
        </Panel>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
            <Panel
              className={cn(
                "relative overflow-hidden border-0 p-6 text-white sm:p-7",
                latest.state === "crisis" ? "!bg-[#9f2232]" : latest.state === "elevated" ? "!bg-[#996313]" : "!bg-sentinel-teal-dark",
              )}
            >
              <Sparkles className="absolute -right-4 -top-5 size-44 text-white/[.05]" strokeWidth={1} />
              <p className="text-sm font-semibold text-white/65">Stress score</p>
              <div className="mt-5 flex items-end gap-2">
                <strong className="font-display text-7xl font-extrabold tracking-[-.07em] sm:text-8xl">
                  {monitoring ? latest.score : "—"}
                </strong>
                {monitoring && <span className="mb-3 text-sm text-white/60">/ 100</span>}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold">
                  <span className="size-2 rounded-full bg-[#8be8d9]" /> {monitoring ? stateLabel(latest.state) : "Paused"} state
                </span>
                {monitoring && latest.stressLevel && (
                  <span className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-[#a9eee3]">
                    {latest.stressLevel}
                  </span>
                )}
              </div>
              {monitoring && (
                <div className="mt-8 border-t border-white/10 pt-5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">Hardware stress level</span>
                    <span className="font-bold text-[#a9eee3]">{latest.stressLevel || "RELAXED"}</span>
                  </div>
                  <Progress value={latest.score} className="mt-3 h-2 bg-white/10 [&>div]:bg-[#8be8d9]" />
                </div>
              )}
            </Panel>
            <Panel className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-sentinel-muted">Hardware telemetry</p>
                  <h2 className="mt-1 font-display text-xl font-extrabold">Stress score active</h2>
                </div>
              </div>
              <div className="mt-8">
                <div className="relative h-3 overflow-hidden rounded-full bg-gradient-to-r from-[#76dcca] via-[#edbd5d] to-[#e45e68]">
                  <span
                    className="absolute top-1/2 size-6 -translate-y-1/2 rounded-full border-[5px] border-white bg-sentinel-ink shadow-md transition-[left] duration-500"
                    style={{ left: `calc(${Math.min(96, monitoring ? latest.score : 0)}% - 12px)` }}
                  />
                </div>
                <div className="mt-3 flex justify-between text-xs font-semibold text-sentinel-muted">
                  <span>Calm · 0–59</span>
                  <span>Elevated · 60–79</span>
                  <span>Crisis · 80+</span>
                </div>
              </div>
              <div className="mt-8 grid gap-3 border-t border-sentinel-line pt-5 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-sentinel-muted">Source</p>
                  <p className="mt-1 text-sm font-bold text-sentinel-teal">Live Device Stream</p>
                </div>
                <div>
                  <p className="text-xs text-sentinel-muted">Confidence</p>
                  <p className="mt-1 text-sm font-bold text-sentinel-teal">High</p>
                </div>
                <div>
                  <p className="text-xs text-sentinel-muted">Sync Rate</p>
                  <p className="mt-1 text-sm font-bold">1 sec · 30s Cloud</p>
                </div>
              </div>
            </Panel>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Panel className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-sentinel-muted">Heart rate</p>
                  <p className="mt-1 font-display text-2xl font-extrabold">
                    {monitoring ? latest.heartRate : "—"} <span className="text-sm font-semibold text-sentinel-muted">BPM</span>
                  </p>
                </div>
                <span className="grid size-10 place-items-center rounded-xl bg-rose-50 text-rose-500">
                  <HeartPulse className="size-5" />
                </span>
              </div>
              <div className="mt-5">
                {monitoring && readings.length > 1 ? (
                  <Sparkline id="heart" values={readings.map((r) => r.heartRate)} color="#eb5b69" />
                ) : (
                  <div className="flex h-[112px] items-center justify-center rounded-2xl bg-slate-50">
                    <p className="text-xs text-sentinel-muted">{monitoring ? "Collecting data…" : "Monitoring paused"}</p>
                  </div>
                )}
              </div>
              <div className="mt-2 flex justify-between text-xs text-sentinel-muted">
                <span>12 readings ago</span>
                <span>Now</span>
              </div>
            </Panel>
            <Panel className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-sentinel-muted">Stress score</p>
                  <p className="mt-1 font-display text-2xl font-extrabold">
                    {monitoring ? latest.stressScore : "—"} <span className="text-sm font-semibold text-sentinel-muted">/ 100</span>
                  </p>
                </div>
                <span className="grid size-10 place-items-center rounded-xl bg-sentinel-soft text-sentinel-teal">
                  <Activity className="size-5" />
                </span>
              </div>
              <div className="mt-5">
                {monitoring && readings.length > 1 ? (
                  <Sparkline id="stress" values={readings.map((r) => r.stressScore)} color="#0c9488" />
                ) : (
                  <div className="flex h-[112px] items-center justify-center rounded-2xl bg-slate-50">
                    <p className="text-xs text-sentinel-muted">{monitoring ? "Collecting data…" : "Monitoring paused"}</p>
                  </div>
                )}
              </div>
              <div className="mt-2 flex justify-between text-xs text-sentinel-muted">
                <span>12 readings ago</span>
                <span>Now</span>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

// ── Insights / AI View ────────────────────────────────────────────────────────
function InsightsView({
  messages,
  aiBusy,
  aiStatus,
  connected,
  monitoring,
  patientAssessment,
  aiRefreshing,
  onAsk,
  onRefreshAI,
}: {
  messages: Message[];
  aiBusy: boolean;
  aiStatus: string;
  connected: boolean;
  monitoring: boolean;
  patientAssessment: PatientAIAssessment | null;
  aiRefreshing: boolean;
  onAsk: (question: string) => void;
  onRefreshAI: () => void;
}) {
  const [question, setQuestion] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = question.trim();
    if (!next) return;
    setQuestion("");
    onAsk(next);
  };
  return (
    <>
      <PageHeading
        eyebrow="Wellness Intelligence"
        title="AI Insights"
        description="Connect your device and ask for an AI-powered analysis of your physiological patterns. All insights are informational and should not replace clinical guidance."
      />

      {/* On-demand Gemini wellness assessment is available only for a live stream. */}
      {connected && monitoring && (
        <Panel className="mb-6 relative overflow-hidden border-2 border-[#b2e8df] bg-gradient-to-r from-[#f0faf8] to-[#ffffff] p-6 sm:p-8 shadow-[0_12px_36px_rgba(12,148,136,.08)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#e1f3ef] pb-5">
            <div className="flex items-center gap-3.5">
              <span className="grid size-12 place-items-center rounded-2xl bg-sentinel-teal text-white shadow-[0_6px_16px_rgba(12,148,136,.25)]">
                <Sparkles className="size-6" />
              </span>
              <div>
                <h2 className="font-display text-xl font-extrabold text-sentinel-teal-dark">
                  Wellness Assessment
                </h2>
                <p className="text-xs text-sentinel-muted mt-0.5">
                  Powered by Google Gemini AI · Personalized wellness evaluation based on live signals
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-sentinel-line bg-white hover:bg-sentinel-soft font-bold"
              disabled={aiRefreshing}
              onClick={onRefreshAI}
            >
              <RefreshCw className={cn("size-3.5", aiRefreshing && "animate-spin text-sentinel-teal")} />
              {aiRefreshing ? "Evaluating…" : "Run Assessment Now"}
            </Button>
          </div>

          {patientAssessment ? (
            <div className="mt-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-sentinel-muted">Current State:</span>
                  <span className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-extrabold shadow-xs",
                    patientAssessment.feelingState === "Calm & Balanced"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      : patientAssessment.feelingState === "Mildly Active"
                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                      : "bg-rose-100 text-rose-800 border border-rose-200",
                  )}>
                    <span className={cn("size-2 rounded-full", patientAssessment.feelingState === "Calm & Balanced" ? "bg-emerald-500" : patientAssessment.feelingState === "Mildly Active" ? "bg-amber-500" : "bg-rose-500")} />
                    {patientAssessment.feelingState}
                  </span>
                </div>
                <p className="text-lg font-medium leading-relaxed text-slate-800">{patientAssessment.statusSummary}</p>
                <div className="rounded-2xl bg-white border border-[#c4eee7] p-4 shadow-xs flex items-start gap-3.5">
                  <span className="grid size-9 place-items-center rounded-xl bg-sentinel-soft text-sentinel-teal shrink-0 mt-0.5">
                    <Lightbulb className="size-5" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-sentinel-teal uppercase tracking-wider">Helpful Tip</p>
                    <p className="mt-1 text-sm text-slate-700 leading-snug">{patientAssessment.comfortTip}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center justify-center py-8 text-center gap-3">
              <Sparkles className="size-8 text-sentinel-teal/40" />
              <p className="text-sm text-sentinel-muted">Press &quot;Run Assessment Now&quot; to get an AI evaluation of your current wellness signals.</p>
            </div>
          )}
        </Panel>
      )}

      {(!connected || !monitoring) && (
        <Panel className="mb-6 p-8 text-center">
          <BluetoothOff className="mx-auto size-10 text-slate-300 mb-3" />
          <h3 className="font-display text-lg font-extrabold">{connected ? "Start Monitoring for a Wellness Assessment" : "Connect Device for AI Insights"}</h3>
          <p className="mt-1 text-sm text-sentinel-muted max-w-sm mx-auto">
            AI wellness assessments are available only while your monitoring device is connected and streaming live data.
          </p>
        </Panel>
      )}

      {/* Ask the assistant — always available */}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Panel className="flex min-h-[520px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-sentinel-line px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-sentinel-mint text-sentinel-teal">
                <Bot className="size-5" />
              </span>
              <div>
                <p className="font-display font-extrabold">SENTINEL Assistant</p>
                <p className="flex items-center gap-1.5 text-xs text-sentinel-muted">
                  <span className="size-1.5 rounded-full bg-sentinel-teal" /> Google Gemini AI · {aiStatus}
                </p>
              </div>
            </div>
            <Sparkles className="size-5 text-sentinel-teal" />
          </div>
          <div className="mx-5 mt-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900 sm:mx-6">
            <strong>Wellness support tool:</strong> AI explanations are informational and should not replace clinical guidance or emergency services.
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
            {messages.map((message) => (
              <div key={message.id} className={cn("anime-panel flex gap-3", message.role === "user" && "justify-end")}>
                {message.role === "assistant" && (
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sentinel-mint text-sentinel-teal">
                    <Bot className="size-4" />
                  </span>
                )}
                <div className={cn("max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6", message.role === "assistant" ? "rounded-tl-md border border-sentinel-line bg-white" : "rounded-tr-md bg-sentinel-ink text-white")}>
                  {message.text}
                </div>
              </div>
            ))}
            {aiBusy && (
              <div className="flex gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-sentinel-mint text-sentinel-teal">
                  <Bot className="size-4" />
                </span>
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-sentinel-line px-4 py-4">
                  <span className="ai-dot size-1.5 rounded-full bg-sentinel-teal" />
                  <span className="ai-dot size-1.5 rounded-full bg-sentinel-teal" />
                  <span className="ai-dot size-1.5 rounded-full bg-sentinel-teal" />
                </div>
              </div>
            )}
          </div>
          <form onSubmit={submit} className="border-t border-sentinel-line p-4 sm:p-5">
            <div className="flex gap-2">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask about your wellness patterns or telemetry trends…"
                aria-label="Question for wellness assistant"
                className="h-11 rounded-xl border-sentinel-line bg-slate-50"
              />
              <Button size="icon" className="size-11 shrink-0 rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark" disabled={aiBusy || !question.trim()} aria-label="Send question">
                <Send />
              </Button>
            </div>
          </form>
        </Panel>
        <aside className="space-y-5">
          <Panel className="p-5">
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-sentinel-teal" />
              <h2 className="font-display text-lg font-extrabold">Quick queries</h2>
            </div>
            <div className="mt-4 space-y-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onAsk(prompt)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-sentinel-line bg-slate-50 p-3 text-left text-sm font-semibold transition hover:border-sentinel-teal/30 hover:bg-sentinel-soft"
                >
                  <span>{prompt}</span>
                  <ChevronRight className="size-4 shrink-0 text-sentinel-teal" />
                </button>
              ))}
            </div>
          </Panel>
          <Panel className="overflow-hidden">
            <div className="border-b border-sentinel-line p-5">
              <div className="flex items-center gap-2">
                <Lightbulb className="size-5 text-sentinel-teal" />
                <h2 className="font-display text-lg font-extrabold">Recent observations</h2>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <div className={cn("rounded-xl border-l-4 p-4", connected && monitoring ? "border-sentinel-teal bg-sentinel-soft" : "border-slate-300 bg-slate-50")}>
                <div className="flex justify-between text-[11px] font-bold uppercase tracking-[.06em] text-sentinel-teal">
                  <span>Device Status</span>
                  <span>{connected && monitoring ? "Live" : connected ? "Paused" : "Offline"}</span>
                </div>
                <p className="mt-2 text-sm leading-5">{connected && monitoring ? "Monitoring device is actively recording physiological signals." : connected ? "Monitoring is paused. Start a live session to create a new assessment." : "Connect your device to start recording."}</p>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

// ── Event Table ───────────────────────────────────────────────────────────────
function EventTable({ events, compact = false }: { events: EventRecord[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead className="min-w-[130px]">Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead className="hidden md:table-cell">Trigger</TableHead>
            <TableHead>Peak</TableHead>
            {!compact && <TableHead>Recovery</TableHead>}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={compact ? 5 : 6} className="h-28 text-center text-sm text-sentinel-muted">
                No events recorded yet. Connect a device to begin collecting data.
              </TableCell>
            </TableRow>
          ) : events.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <p className="text-sm font-bold">{event.date}</p>
                <p className="text-xs text-sentinel-muted">
                  {event.time} · {event.duration}
                </p>
              </TableCell>
              <TableCell>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em]", eventStyles(event.severity))}>
                  {event.severity}
                </span>
                <p className="mt-1.5 text-xs text-sentinel-muted">#{event.id}</p>
              </TableCell>
              <TableCell className="hidden text-sm md:table-cell">{event.trigger}</TableCell>
              <TableCell>
                <span className={cn("font-display text-xl font-extrabold", event.peak >= 80 ? "text-rose-600" : "text-amber-600")}>
                  {event.peak}
                </span>
                <span className="text-xs text-sentinel-muted">/100</span>
              </TableCell>
              {!compact && <TableCell className="text-sm font-semibold">{event.recovery}</TableCell>}
              <TableCell>
                <Button variant="ghost" size="icon-sm" aria-label={`View ${event.id}`}>
                  <MoreHorizontal />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Events View ───────────────────────────────────────────────────────────────
function EventsView({ events, onExport }: { events: EventRecord[]; onExport: () => void }) {
  const averageRecovery = events.length
    ? Math.round(events.reduce((sum, event) => sum + (Number.parseInt(event.recovery, 10) || 0), 0) / events.length)
    : null;
  return (
    <>
      <PageHeading
        eyebrow="Historical record"
        title="Events history"
        description="Review physiological arousal events and observed recovery patterns."
        action={
          <Button className="rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark" onClick={onExport}>
            <Download /> Export CSV
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Crisis events" value={events.filter((event) => event.severity === "Crisis").length} note="No recorded events" icon={Activity} tone="rose" />
        <Metric label="Average recovery" value={averageRecovery ?? "—"} unit={averageRecovery === null ? undefined : "min"} note={averageRecovery === null ? "No recovery data" : "Across recorded events"} icon={Clock3} tone="amber" />
        <Panel className="p-5 sm:p-6">
          <p className="text-sm font-semibold text-sentinel-muted">Event frequency</p>
          <div className="mt-6 flex h-12 items-center justify-center rounded-xl bg-slate-50 text-sm text-sentinel-muted">
            No data yet
          </div>
        </Panel>
      </div>
      <Panel className="mt-5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-sentinel-line p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="font-display text-xl font-extrabold">Detailed log</h2>
            <p className="text-sm text-sentinel-muted">Showing {events.length} recent events</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-lg border-sentinel-line">
              <CalendarClock /> Last 7 days
            </Button>
            <Button variant="outline" size="sm" className="rounded-lg border-sentinel-line">
              <Activity /> All severities
            </Button>
          </div>
        </div>
        <EventTable events={events} />
      </Panel>
    </>
  );
}

// ── Settings View ─────────────────────────────────────────────────────────────
function SettingsView({
  user,
  storageStatus,
  onAuth,
  onSignOut,
}: {
  user: FirebaseAuthState;
  storageStatus: string;
  onAuth: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <PageHeading eyebrow="Portal preferences" title="Settings & Account" description="Manage your account and device connection settings." />
      <div className="grid gap-5 xl:grid-cols-[1fr_.8fr]">
        <div className="space-y-5">
          <Panel className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-sentinel-soft text-sentinel-teal">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <h2 className="font-display text-xl font-extrabold">Account</h2>
                  <p className="mt-1 text-sm text-sentinel-muted">
                    {user
                      ? `Signed in as ${user.email}`
                      : "Signed out · Sign in to save your data."}
                  </p>
                </div>
              </div>
              <span className={cn("rounded-full px-3 py-1.5 text-xs font-bold", user ? "bg-sentinel-soft text-sentinel-teal" : "bg-slate-100 text-slate-600")}>
                {user ? "Authenticated" : "Guest"}
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button className="rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark" onClick={user ? onSignOut : onAuth}>
                {user ? (
                  <><LogOut /> Sign out</>
                ) : (
                  <><LogIn /> Sign In / Register</>
                )}
              </Button>
              <span className="self-center text-xs text-sentinel-muted">{storageStatus}</span>
            </div>
          </Panel>
          <Panel className="divide-y divide-sentinel-line">
            <SettingRow icon={Bell} title="Elevated-state alerts" description="Notify when arousal is sustained above baseline." control={<Switch defaultChecked aria-label="Elevated-state alerts" />} />
            <SettingRow icon={Zap} title="Crisis notifications" description="Escalate if the crisis threshold persists for five minutes." control={<Switch defaultChecked aria-label="Crisis notifications" />} />
            <SettingRow icon={MoonStar} title="Quiet-hours mode" description="Reduce notifications during overnight hours." control={<Switch defaultChecked aria-label="Quiet-hours mode" />} />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel className="p-6">
            <h2 className="font-display text-xl font-extrabold">Platform services</h2>
            <div className="mt-5 space-y-4">
              {[
                { name: "Secure Authentication", note: "Email & password account management" },
                { name: "Cloud Data Sync", note: "30-sec telemetry & assessment archives" },
                { name: "AI Wellness Assistant", note: "On-demand analysis when device is connected" },
                { name: "Wireless Connectivity", note: "Direct device pairing via Web Bluetooth" },
              ].map((service) => (
                <div key={service.name} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">{service.name}</p>
                    <p className="text-xs text-sentinel-muted">{service.note}</p>
                  </div>
                  <BadgeCheck className="size-5 shrink-0 text-sentinel-teal" />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function SettingRow({ icon: Icon, title, description, control }: { icon: IconType; title: string; description: string; control: ReactNode }) {
  return (
    <div className="flex items-center gap-4 p-5 sm:px-6">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sentinel-soft text-sentinel-teal">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs leading-5 text-sentinel-muted">{description}</p>
      </div>
      {control}
    </div>
  );
}

// ── Landing Page ───────────────────────────────────────────────────────────────
function LandingView({ onOpenAuth }: { onOpenAuth: (roleHint?: UserRole) => void }) {
  return (
    <div className="min-h-screen bg-[#f8fbfa] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-sentinel-line bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Brand />
          <div className="flex items-center gap-3">
            <Button
              className="rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark font-bold shadow-[0_4px_14px_rgba(12,148,136,.25)]"
              onClick={() => onOpenAuth("patient")}
            >
              <LogIn className="size-4" /> Sign In / Register
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-[#0c9488] via-[#097369] to-[#142c34] p-8 sm:p-14 text-white shadow-2xl">
          <Waves className="absolute -right-12 -top-16 size-96 text-white/[.04]" strokeWidth={1} />
          <div className="relative max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-bold text-[#8be8d9] backdrop-blur-md mb-5 border border-white/10">
              <Sparkles className="size-3.5 animate-pulse" />
              Congressional App Challenge · SENTINEL Platform
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-[-.04em] sm:text-5xl lg:text-6xl leading-[1.1]">
              Continuous Physiological Intelligence & AI Wellness Companion
            </h1>
            <p className="mt-5 text-base sm:text-lg leading-relaxed text-white/80 max-w-2xl">
              Pair your monitoring device wirelessly to stream real-time heart rate and hardware stress scores. Receive on-demand AI wellness assessments and keep a personal record of your physiological patterns.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                className="h-13 rounded-2xl bg-white text-sentinel-teal-dark hover:bg-slate-100 font-extrabold text-base shadow-lg px-7"
                onClick={() => onOpenAuth("patient")}
              >
                <LogIn className="size-5" /> Get Started / Sign In
              </Button>
            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="mt-12">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs font-bold uppercase tracking-widest text-sentinel-teal">System Capabilities</span>
            <h2 className="font-display text-3xl font-extrabold mt-1">Engineered for Real-Time Care & Wellness</h2>
            <p className="text-sm text-sentinel-muted mt-2">
              Sign in to pair your device, save telemetry, and unlock personalized AI insights.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Panel className="p-6 transition hover:shadow-lg">
              <span className="grid size-12 place-items-center rounded-2xl bg-sentinel-soft text-sentinel-teal mb-5">
                <Bluetooth className="size-6" />
              </span>
              <h3 className="font-display text-lg font-extrabold text-slate-900">Wireless Device Pairing</h3>
              <p className="mt-2 text-xs leading-relaxed text-sentinel-muted">
                Connect directly from your browser to your monitoring device. Streams live heart rate and hardware stress scores in real time.
              </p>
            </Panel>
            <Panel className="p-6 transition hover:shadow-lg">
              <span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600 mb-5">
                <Sparkles className="size-6" />
              </span>
              <h3 className="font-display text-lg font-extrabold text-slate-900">On-Demand AI Wellness</h3>
              <p className="mt-2 text-xs leading-relaxed text-sentinel-muted">
                When your device is connected, request an AI assessment of your vitals, feeling states, and receive actionable comfort recommendations.
              </p>
            </Panel>
            <Panel className="p-6 transition hover:shadow-lg">
              <span className="grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-600 mb-5">
                <Activity className="size-6" />
              </span>
              <h3 className="font-display text-lg font-extrabold text-slate-900">Physiological Monitoring</h3>
              <p className="mt-2 text-xs leading-relaxed text-sentinel-muted">
                Comprehensive arousal metrics, baseline calibration, tiered alerting, and a personal historical record of physiological events.
              </p>
            </Panel>
            <Panel className="p-6 transition hover:shadow-lg">
              <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 mb-5">
                <LockKeyhole className="size-6" />
              </span>
              <h3 className="font-display text-lg font-extrabold text-slate-900">Secure Cloud Sync</h3>
              <p className="mt-2 text-xs leading-relaxed text-sentinel-muted">
                Automatic secure persistence of telemetry samples, calibration records, and wellness assessment archives.
              </p>
            </Panel>
          </div>
        </section>

        {/* CTA Banner */}
        <section className="mt-12 rounded-3xl bg-white border border-sentinel-line p-8 sm:p-10 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="font-display text-2xl font-extrabold">Ready to explore your personal wellness stream?</h3>
            <p className="mt-1 text-sm text-sentinel-muted">
              Create an account or sign in to connect your device and start real-time telemetry recording.
            </p>
          </div>
          <Button
            size="lg"
            className="rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark font-extrabold px-8 shrink-0 h-12"
            onClick={() => onOpenAuth("patient")}
          >
            <LogIn className="size-4" /> Sign In Now
          </Button>
        </section>
      </main>

      <footer className="mt-16 border-t border-sentinel-line bg-white py-8 text-center text-xs text-sentinel-muted">
        SENTINEL Platform · Congressional App Challenge · Wireless Monitoring & AI Wellness
      </footer>
    </div>
  );
}

// ── Main Patient Portal Shell ─────────────────────────────────────────────────
function PatientPortal({
  view,
  setView,
  latest,
  readings,
  events,
  dashboardInsights,
  historicalReadings,
  activeSessionStartedAt,
  connected,
  monitoring,
  storageStatus,
  onConnect,
  onToggleMonitoring,
  onSaveSample,
  messages,
  aiBusy,
  aiStatus,
  patientAssessment,
  aiRefreshing,
  onAsk,
  onRefreshAI,
  onExport,
  user,
  profile,
  onAuth,
  onSignOut,
}: {
  view: PortalView;
  setView: (view: PortalView) => void;
  latest: SensorReading;
  readings: SensorReading[];
  events: EventRecord[];
  dashboardInsights: DashboardInsight[];
  historicalReadings: SensorReading[];
  activeSessionStartedAt: number | null;
  connected: boolean;
  monitoring: boolean;
  storageStatus: string;
  onConnect: () => void;
  onToggleMonitoring: () => void;
  onSaveSample: () => void;
  messages: Message[];
  aiBusy: boolean;
  aiStatus: string;
  patientAssessment: PatientAIAssessment | null;
  aiRefreshing: boolean;
  onAsk: (question: string) => void;
  onRefreshAI: () => void;
  onExport: () => void;
  user: FirebaseAuthState;
  profile: UserProfile | null;
  onAuth: () => void;
  onSignOut: () => void;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const currentLabel = navigation.find((item) => item.id === view)?.label ?? "Overview";
  const displayName = profile?.displayName || user?.email?.split("@")[0] || "Wellness User";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_1fr]">
      {/* Sidebar */}
      <aside className="hidden border-r border-sentinel-line bg-white lg:flex lg:flex-col">
        <div className="px-7 py-7">
          <Brand />
        </div>
        <nav className="mt-4 space-y-1 px-4" aria-label="Patient portal navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition",
                view === id ? "bg-sentinel-mint text-sentinel-teal-dark shadow-[inset_3px_0_0_#0c9488]" : "text-sentinel-muted hover:bg-slate-50 hover:text-sentinel-ink",
              )}
            >
              <Icon className="size-[18px]" />
              {label}
            </button>
          ))}
        </nav>

        {/* Device status widget in sidebar */}
        <div className={cn("mx-5 mt-7 rounded-2xl p-4", connected ? (monitoring ? "bg-sentinel-teal-dark text-white" : "bg-slate-100 text-slate-700") : "bg-slate-100 text-slate-500")}>
          <div className={cn("flex items-center gap-2 text-xs font-bold", connected && monitoring ? "text-[#a9eee3]" : "text-slate-500")}>
            {connected ? <Bluetooth className="size-4" /> : <BluetoothOff className="size-4" />}
            {connected ? (monitoring ? "Monitoring Active" : "Device Paused") : "No Device"}
          </div>
          <p className={cn("mt-2 text-sm leading-5", connected ? "text-white/80" : "text-slate-500")}>
            {connected
              ? monitoring
                ? "Live data is streaming. Use the monitoring toggle to pause at any time."
                : "Device is connected but monitoring is paused."
              : "Pair a device to begin live physiological monitoring."}
          </p>
          {connected && (
            <button onClick={onToggleMonitoring} className={cn("mt-3 text-xs font-bold", connected && monitoring ? "text-white" : "text-sentinel-teal")}>
              {monitoring ? "Stop Monitoring →" : "Start Monitoring →"}
            </button>
          )}
        </div>

        <div className="mt-auto border-t border-sentinel-line p-5">
          <button onClick={user ? onSignOut : onAuth} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-slate-50">
            <span className="grid size-9 place-items-center rounded-full bg-sentinel-soft font-bold text-sentinel-teal">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{displayName}</span>
              <span className="block truncate text-xs text-sentinel-muted">
                {user ? user.email : "Tap to sign in"}
              </span>
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <section className="min-w-0">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-sentinel-line bg-white/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setMobileNav(true)} aria-label="Open navigation">
              <Menu />
            </Button>
            <Brand compact />
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-bold uppercase tracking-[.12em] text-sentinel-muted">{currentLabel}</p>
            <p className="font-display text-lg font-extrabold">{displayName}</p>
          </div>
          <div className="flex items-center gap-2">
            {connected && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "hidden rounded-xl border-sentinel-line sm:flex",
                  monitoring ? "text-rose-600 hover:border-rose-200 hover:bg-rose-50" : "text-sentinel-teal hover:bg-sentinel-soft",
                )}
                onClick={onToggleMonitoring}
              >
                {monitoring ? <><Square className="size-3.5" /> Stop</> : <><Play className="size-3.5" /> Monitor</>}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="hidden rounded-xl border-sentinel-line sm:flex"
              onClick={onSaveSample}
              disabled={!connected || !monitoring}
            >
              <Download className="size-3.5" /> Save Vitals
            </Button>
            {user ? (
              <Button variant="outline" size="sm" className="rounded-xl border-sentinel-line" onClick={onSignOut}>
                <LogOut className="size-3.5" /> Sign out
              </Button>
            ) : (
              <Button size="sm" className="rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark" onClick={onAuth}>
                <LogIn className="size-3.5" /> Sign in
              </Button>
            )}
          </div>
        </header>

        {mobileNav && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button className="absolute inset-0 bg-slate-950/30 backdrop-blur-sm" onClick={() => setMobileNav(false)} aria-label="Close navigation" />
            <aside className="anime-panel relative h-full w-[min(320px,86vw)] bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <Brand />
                <Button variant="ghost" size="icon" onClick={() => setMobileNav(false)}>
                  <X />
                </Button>
              </div>
              <nav className="mt-8 space-y-1">
                {navigation.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => { setView(id); setMobileNav(false); }}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold", view === id ? "bg-sentinel-mint text-sentinel-teal-dark" : "text-sentinel-muted")}
                  >
                    <Icon className="size-5" />
                    {label}
                  </button>
                ))}
              </nav>
              {connected && (
                <Button
                  className={cn("mt-6 w-full rounded-xl", monitoring ? "bg-rose-600 hover:bg-rose-700" : "bg-sentinel-teal hover:bg-sentinel-teal-dark")}
                  onClick={() => { onToggleMonitoring(); setMobileNav(false); }}
                >
                  {monitoring ? <><Square className="size-4" /> Stop Monitoring</> : <><Play className="size-4" /> Start Monitoring</>}
                </Button>
              )}
            </aside>
          </div>
        )}

        <div className="mx-auto max-w-[1420px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          {view === "overview" && (
            <OverviewView
              events={events}
              insights={dashboardInsights}
              historicalReadings={historicalReadings}
              activeSessionStartedAt={activeSessionStartedAt}
              onNavigate={setView}
            />
          )}
          {view === "live" && (
            <LiveView
              latest={latest}
              readings={readings}
              connected={connected}
              monitoring={monitoring}
              storageStatus={storageStatus}
              stressLevel={latest.stressLevel}
              onConnect={onConnect}
              onToggleMonitoring={onToggleMonitoring}
            />
          )}
          {view === "insights" && (
            <InsightsView
              messages={messages}
              aiBusy={aiBusy}
              aiStatus={aiStatus}
              connected={connected}
              monitoring={monitoring}
              patientAssessment={patientAssessment}
              aiRefreshing={aiRefreshing}
              onAsk={onAsk}
              onRefreshAI={onRefreshAI}
            />
          )}
          {view === "events" && <EventsView events={events} onExport={onExport} />}
          {view === "settings" && (
            <SettingsView
              user={user}
              storageStatus={storageStatus}
              onAuth={onAuth}
              onSignOut={onSignOut}
            />
          )}
        </div>
      </section>
    </div>
  );
}

// ── Auth Dialog ───────────────────────────────────────────────────────────────
function AuthDialog({
  open,
  defaultRole = "patient",
  onOpenChange,
  onAuthSuccess,
}: {
  open: boolean;
  defaultRole?: UserRole;
  onOpenChange: (open: boolean) => void;
  onAuthSuccess: (role: UserRole, user?: FirebaseAuthState, profile?: UserProfile | null) => void;
}) {
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [selectedRole] = useState<UserRole>(defaultRole);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      const firebase = await import("@/lib/firebase");
      if (tab === "signin") {
        try {
          const signinResult = await firebase.signInUser(email, password);
          const resolvedRole = signinResult.profile?.role || selectedRole || "patient";
          toast.success(`Welcome back, ${signinResult.profile?.displayName || email.split("@")[0]}!`);
          onAuthSuccess(resolvedRole, signinResult.credential.user, signinResult.profile);
          onOpenChange(false);
        } catch (signInErr: unknown) {
          const errCode = (signInErr as { code?: string })?.code || "";
          if (
            errCode === "auth/user-not-found" ||
            errCode === "auth/invalid-credential" ||
            errCode === "auth/wrong-password"
          ) {
            toast.error("No account found with these credentials.", {
              description: "Switched to 'Create Account' tab so you can register now.",
            });
            setTab("register");
          } else {
            toast.error(signInErr instanceof Error ? signInErr.message : "Sign-in failed. Please try again.");
          }
        }
      } else {
        try {
          const registerResult = await firebase.registerUser(email, password, "patient", displayName);
          toast.success(`Account created! Welcome, ${registerResult.profile.displayName}.`);
          onAuthSuccess("patient", registerResult.credential.user, registerResult.profile);
          onOpenChange(false);
        } catch (regErr: unknown) {
          const errCode = (regErr as { code?: string })?.code || "";
          if (errCode === "auth/email-already-in-use") {
            toast.info("This email is already registered. Attempting to sign in...");
            try {
              const signinResult = await firebase.signInUser(email, password);
              const resolvedRole = signinResult.profile?.role || "patient";
              toast.success(`Signed in successfully as ${signinResult.profile?.displayName || "User"}.`);
              onAuthSuccess(resolvedRole, signinResult.credential.user, signinResult.profile);
              onOpenChange(false);
            } catch {
              toast.error("Account already exists. Please enter your password on the Sign In tab.");
              setTab("signin");
            }
          } else {
            toast.error(regErr instanceof Error ? regErr.message : "Registration failed.");
          }
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication error occurred.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] border-sentinel-line sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 grid size-12 place-items-center rounded-2xl bg-sentinel-soft text-sentinel-teal">
            <LockKeyhole className="size-6" />
          </div>
          <DialogTitle className="font-display text-2xl font-extrabold">
            {tab === "signin" ? "Welcome Back to SENTINEL" : "Create SENTINEL Account"}
          </DialogTitle>
          <DialogDescription>
            {tab === "signin"
              ? "Sign in to access your personalized telemetry, records, and real-time wellness insights."
              : "Register to sync your device readings and wellness history to the cloud."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex rounded-xl bg-slate-100 p-1 mt-2">
          <button
            type="button"
            className={cn("flex-1 rounded-lg py-2 text-xs font-bold transition", tab === "signin" ? "bg-white shadow-xs text-sentinel-teal-dark" : "text-slate-600 hover:text-slate-900")}
            onClick={() => setTab("signin")}
          >
            Sign In
          </button>
          <button
            type="button"
            className={cn("flex-1 rounded-lg py-2 text-xs font-bold transition", tab === "register" ? "bg-white shadow-xs text-sentinel-teal-dark" : "text-slate-600 hover:text-slate-900")}
            onClick={() => setTab("register")}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {tab === "register" && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="displayName">
                Full Name / Display Name
              </label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. John Doe"
                className="h-11 rounded-xl border-sentinel-line"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="email">
              Email Address
            </label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-11 rounded-xl border-sentinel-line"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="h-11 rounded-xl border-sentinel-line"
            />
          </div>

          <DialogFooter className="gap-2 pt-2 sm:justify-stretch flex-col">
            <Button
              type="submit"
              className="w-full rounded-xl bg-sentinel-teal hover:bg-sentinel-teal-dark h-11 text-sm font-bold"
              disabled={busy}
            >
              {busy ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : tab === "signin" ? (
                <LogIn className="size-4" />
              ) : (
                <UserCheck className="size-4" />
              )}
              {tab === "signin" ? "Sign In & Enter Portal" : "Create Account & Continue"}
            </Button>

            <div className="text-center mt-1">
              {tab === "signin" ? (
                <button type="button" className="text-xs text-sentinel-teal font-semibold hover:underline" onClick={() => setTab("register")}>
                  Don&apos;t have an account? Click here to register
                </button>
              ) : (
                <button type="button" className="text-xs text-sentinel-teal font-semibold hover:underline" onClick={() => setTab("signin")}>
                  Already have an account? Click here to sign in
                </button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Fallback assistant ────────────────────────────────────────────────────────
function fallbackAssistant(question: string, latest: SensorReading | null) {
  const lower = question.toLowerCase();
  if (!latest) {
    if (lower.includes("de-escal") || lower.includes("help") || lower.includes("calm")) {
      return "Start with the person's established care plan: reduce noise and demands, offer a quieter space, check comfort needs, and give them time to respond. If there is immediate danger, follow the safety plan and contact local emergency services.";
    }
    if (lower.includes("baseline") || lower.includes("summar") || lower.includes("trend") || lower.includes("data")) {
      return "There is not enough recorded telemetry to evaluate a baseline or trend yet. Pair the monitoring device and allow it to collect several readings before drawing conclusions; a single reading should not be treated as a diagnosis.";
    }
    return "I can help interpret patterns, but there is no live telemetry available yet. Connect the monitoring device first, then ask me about a trend, a change from baseline, or general support strategies.";
  }
  if (lower.includes("baseline")) {
    return `A baseline cannot be confirmed from one live reading. The current signal is ${latest.stressLevel || "relaxed"}, so the useful next step is to collect several readings under ordinary conditions and compare the pattern rather than reacting to one number.`;
  }
  if (lower.includes("12 hours") || lower.includes("summar")) {
    return "I do not have enough historical readings to summarize the last 12 hours. Continue monitoring for a longer window so we can distinguish a sustained pattern from a brief change.";
  }
  if (lower.includes("de-escal")) {
    return "Consider your established care plan first: reduce surrounding noise, check comfort, offer water, and allow a quiet rest space. If there is immediate danger, follow your safety protocol.";
  }
  return `The current signal is classified as ${stateLabel(latest.state).toLowerCase()}, but that classification is only a screening cue—not an explanation of how the person feels or why the change occurred. Look for context, compare it with the person's established baseline, and follow their care plan if they appear uncomfortable.`;
}

// ── Main App Root ─────────────────────────────────────────────────────────────
export default function SentinelApp() {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PortalMode>("landing");
  const [view, setView] = useState<PortalView>("overview");
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [connection, setConnection] = useState<PulseGuardConnection | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [storageStatus, setStorageStatus] = useState("Local buffer");
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [historicalReadings, setHistoricalReadings] = useState<SensorReading[]>([]);
  const [activeSessionStartedAt, setActiveSessionStartedAt] = useState<number | null>(null);
  const [dashboardInsights, setDashboardInsights] = useState<DashboardInsight[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = JSON.parse(localStorage.getItem("sentinel-dashboard-insights") ?? "[]") as DashboardInsight[];
      return Array.isArray(saved) ? saved.slice(0, 24) : [];
    } catch {
      return [];
    }
  });
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState("AI Wellness Assistant ready");

  // Auth state
  const [user, setUser] = useState<FirebaseAuthState>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authRoleHint, setAuthRoleHint] = useState<UserRole>("patient");

  // AI assessment state (on-demand only, no auto timer)
  const [patientAssessment, setPatientAssessment] = useState<PatientAIAssessment | null>(null);
  const [aiRefreshing, setAiRefreshing] = useState(false);

  const sensorSnapshot = useRef<PulseGuardSnapshot>({});
  const lastSensorPublish = useRef(0);
  const latestRef = useRef<SensorReading | null>(null);
  const readingsRef = useRef<SensorReading[]>([]);
  const sessionReadingsRef = useRef<SensorReading[]>([]);
  const monitoringRef = useRef(false);
  const monitoringStartedAt = useRef<number | null>(null);
  const previousState = useRef<ArousalState>("calm");

  // Always keep latest reading in a ref
  const latest = readings[readings.length - 1];
  useEffect(() => {
    if (latest) latestRef.current = latest;
  }, [latest]);

  useEffect(() => {
    monitoringRef.current = monitoring;
  }, [monitoring]);

  useEffect(() => {
    try {
      localStorage.setItem("sentinel-dashboard-insights", JSON.stringify(dashboardInsights.slice(0, 24)));
    } catch {
      // The on-screen session history remains useful if local storage is unavailable.
    }
  }, [dashboardInsights]);

  // Firebase Auth Observer — on auth change, go to portal
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let stopRealtimeTelemetry: (() => void) | undefined;
    let stopRealtimeEvents: (() => void) | undefined;
    void import("@/lib/firebase")
      .then((firebase) => {
        unsubscribe = firebase.observeAuth((nextUser, nextProfile) => {
          stopRealtimeTelemetry?.();
          stopRealtimeEvents?.();
          setUser(nextUser);
          setProfile(nextProfile);
          setStorageStatus(nextUser ? "Realtime Database sync enabled" : "Local buffer");
          if (nextUser) {
            setMode("portal");
            stopRealtimeTelemetry = firebase.subscribeToRealtimeTelemetry(setHistoricalReadings);
            stopRealtimeEvents = firebase.subscribeToRealtimeEvents(setEvents);
            void firebase.loadDashboardInsights(nextProfile?.patientId || nextUser.uid)
              .then((cloudInsights) => {
                if (!cloudInsights.length) return;
                setDashboardInsights((current) => {
                  const merged = [...cloudInsights, ...current.filter((insight) => !cloudInsights.some((cloud) => cloud.id === insight.id))];
                  return merged.sort((a, b) => b.endedAt - a.endedAt).slice(0, 24);
                });
              });
          } else {
            setHistoricalReadings([]);
            setEvents([]);
          }
        });
      })
      .catch(() => setStorageStatus("Local buffer"));
    return () => {
      unsubscribe?.();
      stopRealtimeTelemetry?.();
      stopRealtimeEvents?.();
    };
  }, []);

  // Anime.js Motion Scopes
  useEffect(() => {
    if (!root.current) return;
    const scope = createScope({ root }).add(() => {
      const panels = root.current?.querySelectorAll(".anime-panel");
      const metrics = root.current?.querySelectorAll(".anime-metric");
      const lines = root.current?.querySelectorAll(".anime-line");
      const pulses = root.current?.querySelectorAll(".live-dot");
      const dots = root.current?.querySelectorAll(".ai-dot");
      if (panels?.length) animate(panels, { opacity: [0, 1], y: [14, 0], delay: stagger(38), duration: 620, ease: "out(3)" });
      if (metrics?.length) animate(metrics, { opacity: [0, 1], scale: [0.96, 1], delay: stagger(42), duration: 540, ease: "out(3)" });
      if (lines?.length) animate(lines, { opacity: [0.1, 1], duration: 800, delay: 180, ease: "out(2)" });
      if (pulses?.length) animate(pulses, { opacity: [0.75, 0.08], scale: [0.78, 1.3], duration: 1250, loop: true, alternate: true, ease: "inOut(2)" });
      if (dots?.length) animate(dots, { y: [0, -4], delay: stagger(120), duration: 440, loop: true, alternate: true, ease: "inOut(2)" });
    });
    return () => scope.revert();
  }, [mode, view]);

  // Add a new reading — only when device is connected AND monitoring is active
  const addReading = useCallback((reading: SensorReading) => {
    if (!monitoringStartedAt.current) monitoringStartedAt.current = reading.capturedAt;
    sessionReadingsRef.current = [...sessionReadingsRef.current.slice(-3_599), reading];
    setReadings((current) => {
      const next = [...current.slice(-35), reading];
      readingsRef.current = next;
      return next;
    });
    if (reading.state !== "calm" && previousState.current === "calm") {
      const severity = reading.state === "crisis" ? "Crisis" : "Elevated";
      const event: EventRecord = {
        id: `EVT-${Date.now()}`,
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        time: formatTime(reading.capturedAt),
        severity,
        peak: reading.score,
        duration: "Active",
        trigger: "Live signal change",
        recovery: "—",
      };
      setEvents((current) => [
        event,
        ...current,
      ]);
      if (user) {
        void import("@/lib/firebase")
          .then((firebase) => firebase.saveRealtimeEvent(event))
          .catch(() => setStorageStatus("Realtime Database sync unavailable"));
      }
      toast.warning(`${severity} physiological change detected`, {
        description: "Check your comfort and follow your established care plan.",
      });
    }
    previousState.current = reading.state;
  }, [user]);

  // Sync an account-scoped historical sample every five seconds while live.
  useEffect(() => {
    if (mode !== "portal" || !monitoring) return;
    const interval = window.setInterval(() => {
      const reading = latestRef.current;
      if (!reading) return;
      try {
        const stored = JSON.parse(localStorage.getItem("sentinel-telemetry") ?? "[]") as SensorReading[];
        localStorage.setItem("sentinel-telemetry", JSON.stringify([...stored.slice(-239), reading]));
      } catch {
        /* ignore storage limitations */
      }
      if (user) {
        void import("@/lib/firebase")
          .then((firebase) => firebase.saveRealtimeTelemetrySample(reading))
          .then(() => setStorageStatus(`Realtime DB synced ${formatTime(Date.now())}`))
          .catch(() => setStorageStatus("Local buffer · Realtime Database unavailable"));
      }
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [mode, monitoring, user]);

  // Manual save sample
  const handleSaveSample = useCallback(async () => {
    const reading = latestRef.current;
    if (!reading) {
      toast.info("No data to save. Connect your device and start monitoring first.");
      return;
    }
    if (!user) {
      toast.info("Please sign in to sync telemetry to your cloud account.");
      setAuthOpen(true);
      return;
    }
    try {
      const firebase = await import("@/lib/firebase");
      await firebase.saveRealtimeTelemetrySample(reading);
      void firebase.saveTelemetrySample(reading, profile?.patientId || user.uid);
      setStorageStatus(`Saved ${formatTime(Date.now())}`);
      toast.success("Stress reading recorded to cloud!", {
        description: `Saved: ${reading.heartRate} BPM, stress score ${reading.stressScore}/100.`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save vitals.");
    }
  }, [profile, user]);

  // On-demand AI Assessment — only runs when explicitly called
  const runPatientAIEvaluation = useCallback(async () => {
    const current = latestRef.current;
    if (!current) {
      toast.info("No live data available. Connect your device and start monitoring first.");
      return;
    }
    setAiRefreshing(true);
    try {
      const firebase = await import("@/lib/firebase");
      const assessment = await firebase.generatePatientStatusAssessment({
        heartRate: current.heartRate,
        stressScore: current.stressScore,
        score: current.score,
        state: current.state,
        stressLevel: current.stressLevel,
        recentTrend: `Arousal ${current.score}/100, level: ${current.stressLevel || "Relaxed"}`,
      });
      setPatientAssessment(assessment);
      if (user) {
        await firebase.savePatientAIAssessment(assessment, profile?.patientId || user.uid);
      }
    } catch (e) {
      console.warn("AI evaluation error:", e);
      toast.error("Could not complete wellness assessment. Please try again.");
    } finally {
      setAiRefreshing(false);
    }
  }, [profile, user]);

  const finishMonitoringSession = useCallback(async () => {
    const startedAt = monitoringStartedAt.current;
    const endedAt = Date.now();
    monitoringStartedAt.current = null;
    setActiveSessionStartedAt(null);
    if (!startedAt) return;

    const sessionReadings = sessionReadingsRef.current.filter((reading) => reading.capturedAt >= startedAt && reading.capturedAt <= endedAt);
    const provisionalInsight = createSessionSummary(sessionReadings, startedAt, endedAt);
    if (!provisionalInsight) return;
    sessionReadingsRef.current = [];

    // Make the completed session available to the historical charts immediately;
    // the Realtime Database subscription then keeps it synchronized per account.
    setHistoricalReadings((current) => {
      const byId = new Map(current.map((reading) => [reading.id, reading]));
      sessionReadings.forEach((reading) => byId.set(reading.id, reading));
      return [...byId.values()].sort((a, b) => a.capturedAt - b.capturedAt).slice(-2_000);
    });

    setDashboardInsights((current) => [provisionalInsight, ...current].slice(0, 24));
    toast.success("Session saved to your dashboard", {
      description: "A completed-session insight is ready; Gemini is refining the summary.",
    });

    try {
      const firebase = await import("@/lib/firebase");
      if (user) {
        void firebase.saveRealtimeTelemetrySamples(sessionReadings).catch(() => {
          setStorageStatus("Realtime Database sync unavailable");
        });
      }
      const trend = provisionalInsight.pattern.includes("eased") ? "decreased" : provisionalInsight.pattern.includes("rose") ? "increased" : "steady";
      const geminiInsight = await firebase.generateDashboardSessionInsight({
        sampleCount: provisionalInsight.sampleCount,
        durationMinutes: Math.max(1, Math.round((endedAt - startedAt) / 60_000)),
        averageHeartRate: provisionalInsight.averageHeartRate,
        averageStressScore: provisionalInsight.averageStressScore,
        peakStressScore: provisionalInsight.peakStressScore,
        calmPercentage: provisionalInsight.calmPercentage,
        trend,
      });
      const completedInsight: DashboardInsight = {
        ...provisionalInsight,
        ...geminiInsight,
        source: "Google Gemini",
      };
      setDashboardInsights((current) => current.map((insight) => insight.id === completedInsight.id ? completedInsight : insight));
      if (user) await firebase.saveDashboardInsight(completedInsight, profile?.patientId || user.uid);
    } catch (error) {
      console.info("Gemini session insight unavailable; retaining local session summary.", error);
    }
  }, [profile, user]);

  // Web Bluetooth Connect
  const connect = useCallback(async () => {
    if (!supportsWebBluetooth()) {
      toast.error("Wireless pairing is unavailable in this browser.", {
        description: "Open the app in Chrome or Edge over HTTPS to pair your device.",
      });
      return;
    }
    try {
      connection?.disconnect();
      const next = await connectPulseGuard(
        (snapshot) => {
          sensorSnapshot.current = { ...sensorSnapshot.current, ...snapshot };
          const now = Date.now();
          const hr = sensorSnapshot.current.heartRate;
          const stress = sensorSnapshot.current.stress;
          // Live metrics and readings are collected only while monitoring is active.
          if (monitoringRef.current && hr !== undefined && stress !== undefined && now - lastSensorPublish.current > 700) {
            lastSensorPublish.current = now;
            addReading(createHardwareReading(hr, stress, "bluetooth"));
          }
        },
        () => {
          monitoringRef.current = false;
          setConnection(null);
          setMonitoring(false);
          void finishMonitoringSession();
          setView("overview");
          toast.info("Device disconnected.");
        },
      );
      setConnection(next);
      sessionReadingsRef.current = [];
      readingsRef.current = [];
      latestRef.current = null;
      setReadings([]);
      monitoringRef.current = true;
      monitoringStartedAt.current = Date.now();
      setActiveSessionStartedAt(monitoringStartedAt.current);
      setMonitoring(true); // Auto-start monitoring on successful connect
      toast.success(`${next.name} Connected`, {
        description: "Receiving live physiological data via wireless connection.",
      });
    } catch (error) {
      if ((error as Error).name !== "NotFoundError") {
        toast.error(error instanceof Error ? error.message : "Could not connect to the device.");
      }
    }
  }, [addReading, connection, finishMonitoringSession]);

  const toggleMonitoring = useCallback(() => {
    if (!connection) {
      toast.info("Connect a device first.");
      return;
    }
    if (monitoringRef.current) {
      monitoringRef.current = false;
      setMonitoring(false);
      void finishMonitoringSession();
      setView("overview");
      toast.info("Monitoring stopped. Completed-session insights are now on your dashboard.");
      return;
    }
    monitoringRef.current = true;
    sessionReadingsRef.current = [];
    readingsRef.current = [];
    latestRef.current = null;
    setReadings([]);
    monitoringStartedAt.current = Date.now();
    setActiveSessionStartedAt(monitoringStartedAt.current);
    setMonitoring(true);
    toast.info("Monitoring resumed.");
  }, [connection, finishMonitoringSession]);

  const ask = useCallback(
    async (question: string) => {
      const userMessage: Message = { id: `user-${Date.now()}`, role: "user", text: question };
      setMessages((current) => [...current, userMessage]);
      setAiBusy(true);
      const current = latestRef.current;
      const context = current
        ? `Patient Telemetry: Hardware stress score: ${current.stressScore}/100 (${current.state}). Heart rate: ${current.heartRate} BPM. Stress level: ${current.stressLevel || "RELAXED"}.`
        : "No live telemetry data available at this time.";
      try {
        const firebase = await import("@/lib/firebase");
        const response = await firebase.askCareAssistant(question, context);
        setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: "assistant", text: response }]);
        setAiStatus("AI Assistant connected");
      } catch {
        setMessages((current) => [
          ...current,
          { id: `assistant-${Date.now()}`, role: "assistant", text: fallbackAssistant(question, latestRef.current) },
        ]);
        setAiStatus("Safe fallback response");
      } finally {
        setAiBusy(false);
      }
    },
    [],
  );

  const exportEvents = useCallback(() => {
    const header = "event_id,date,time,severity,peak_arousal,duration,trigger,recovery\n";
    const rows = events
      .map((event) =>
        [event.id, event.date, event.time, event.severity, event.peak, event.duration, event.trigger, event.recovery]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([header + rows], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "sentinel-events.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Event history exported.");
  }, [events]);

  const handleSignOut = useCallback(async () => {
    const firebase = await import("@/lib/firebase");
    await firebase.signOutUser();
    setUser(null);
    setProfile(null);
    setMode("landing");
    setConnection(null);
    monitoringRef.current = false;
    monitoringStartedAt.current = null;
    setActiveSessionStartedAt(null);
    setMonitoring(false);
    setReadings([]);
    toast.success("Signed out. Returned to welcome page.");
  }, []);

  // Safe fallback for when no reading is available yet
  const safeLatest: SensorReading = latest ?? {
    heartRate: 0, gsr: 0, score: 0, stressScore: 0, state: "calm" as ArousalState, source: "demo", capturedAt: 0,
  };

  return (
    <div ref={root} className="min-h-screen bg-sentinel-canvas text-sentinel-ink">
      {mode === "landing" ? (
        <LandingView
          onOpenAuth={(roleHint) => {
            setAuthRoleHint(roleHint || "patient");
            setAuthOpen(true);
          }}
        />
      ) : (
        <PatientPortal
          view={view}
          setView={setView}
          latest={safeLatest}
          readings={readings}
          events={events}
          dashboardInsights={dashboardInsights}
          historicalReadings={historicalReadings}
          activeSessionStartedAt={activeSessionStartedAt}
          connected={Boolean(connection)}
          monitoring={monitoring}
          storageStatus={storageStatus}
          onConnect={connect}
          onToggleMonitoring={toggleMonitoring}
          onSaveSample={handleSaveSample}
          messages={messages}
          aiBusy={aiBusy}
          aiStatus={aiStatus}
          patientAssessment={patientAssessment}
          aiRefreshing={aiRefreshing}
          onAsk={ask}
          onRefreshAI={() => void runPatientAIEvaluation()}
          onExport={exportEvents}
          user={user}
          profile={profile}
          onAuth={() => setAuthOpen(true)}
          onSignOut={handleSignOut}
        />
      )}

      <AuthDialog
        open={authOpen}
        defaultRole={authRoleHint}
        onOpenChange={setAuthOpen}
        onAuthSuccess={(authenticatedRole, authUser, authProfile) => {
          if (authUser !== undefined) setUser(authUser);
          if (authProfile !== undefined) setProfile(authProfile);
          setStorageStatus(authUser ? "Firestore sync enabled" : "Local buffer");
          setMode("portal");
          void (authenticatedRole);
        }}
      />
      <Toaster richColors position="top-right" />
    </div>
  );
}
