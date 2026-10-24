"use client";

import { useId, useMemo, useSyncExternalStore } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { HeartPulse, Clock, AlertCircle } from "lucide-react";
import type { SensorReading } from "@/lib/arousal";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};
function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export type TimeRange = "15m" | "1h" | "6h" | "24h" | "7d" | "all";

export const TIME_RANGE_OPTIONS: Array<{ id: TimeRange; label: string; fullLabel: string }> = [
  { id: "15m", label: "15m", fullLabel: "Last 15 minutes" },
  { id: "1h", label: "1h", fullLabel: "Last 1 hour" },
  { id: "6h", label: "6h", fullLabel: "Last 6 hours" },
  { id: "24h", label: "24h", fullLabel: "Last 24 hours" },
  { id: "7d", label: "7d", fullLabel: "Last 7 days" },
  { id: "all", label: "All", fullLabel: "All recorded history" },
];

export function filterReadingsByTimeRange(
  readings: SensorReading[],
  range: TimeRange,
  now = Date.now(),
): SensorReading[] {
  if (range === "all") return readings;
  const msMap: Record<TimeRange, number> = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    all: Infinity,
  };
  const cutoff = now - msMap[range];
  return readings.filter((r) => r.capturedAt >= cutoff);
}

function formatChartTime(timestamp: number, range: TimeRange) {
  const date = new Date(timestamp);
  if (range === "15m" || range === "1h") {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }
  if (range === "6h" || range === "24h") {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatFullDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

/**
 * Downsamples large datasets to prevent sluggish SVG re-renders while
 * preserving key peaks and bounds.
 */
function downsampleReadings(readings: SensorReading[], maxPoints = 200): SensorReading[] {
  if (readings.length <= maxPoints) return readings;
  const step = Math.ceil(readings.length / maxPoints);
  const result: SensorReading[] = [];
  for (let i = 0; i < readings.length; i += step) {
    result.push(readings[i]);
  }
  const last = readings[readings.length - 1];
  if (result[result.length - 1].id !== last.id) {
    result.push(last);
  }
  return result;
}

// ── Time Range Selector Component ───────────────────────────────────────────
export function TimeRangeSelector({
  selected,
  onChange,
  className,
}: {
  selected: TimeRange;
  onChange: (range: TimeRange) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Chart time range"
      className={cn("inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 border border-slate-200/80", className)}
    >
      {TIME_RANGE_OPTIONS.map((opt) => {
        const isActive = selected === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={opt.fullLabel}
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-bold transition-all select-none",
              isActive
                ? "bg-sentinel-teal text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Empty State Component ───────────────────────────────────────────────────
export function ChartEmptyState({
  timeRange,
  hasAnyData,
  onResetRange,
  onNavigateLive,
}: {
  timeRange: TimeRange;
  hasAnyData: boolean;
  onResetRange?: () => void;
  onNavigateLive?: () => void;
}) {
  const rangeInfo = TIME_RANGE_OPTIONS.find((o) => o.id === timeRange);

  if (!hasAnyData) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center rounded-2xl bg-slate-50/80 p-6 text-center border border-dashed border-slate-200">
        <span className="grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-500 mb-3">
          <HeartPulse className="size-6" />
        </span>
        <p className="font-display text-base font-extrabold text-slate-800">No telemetry recorded yet</p>
        <p className="mt-1 text-xs text-sentinel-muted max-w-sm">
          Connect your PulseGuard device and start live monitoring. Readings and events will securely persist to Firebase Realtime Database and populate this chart automatically.
        </p>
        {onNavigateLive && (
          <button
            type="button"
            onClick={onNavigateLive}
            className="mt-4 rounded-xl bg-sentinel-teal px-4 py-2 text-xs font-bold text-white hover:bg-sentinel-teal-dark transition"
          >
            Start Live Monitoring →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[240px] flex-col items-center justify-center rounded-2xl bg-slate-50/80 p-6 text-center border border-dashed border-slate-200">
      <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 mb-3">
        <Clock className="size-6" />
      </span>
      <p className="font-display text-base font-extrabold text-slate-800">
        No readings in {rangeInfo?.fullLabel.toLowerCase() || "this range"}
      </p>
      <p className="mt-1 text-xs text-sentinel-muted max-w-sm">
        You have earlier recorded sessions saved in the cloud. Expand your time range to view historical patterns or resume live monitoring.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {onResetRange && (
          <button
            type="button"
            onClick={onResetRange}
            className="rounded-xl border border-sentinel-line bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            View All History
          </button>
        )}
        {onNavigateLive && (
          <button
            type="button"
            onClick={onNavigateLive}
            className="rounded-xl bg-sentinel-teal px-3.5 py-1.5 text-xs font-bold text-white hover:bg-sentinel-teal-dark transition"
          >
            Open Live Monitoring
          </button>
        )}
      </div>
    </div>
  );
}

// ── Heart Rate Custom Tooltip ───────────────────────────────────────────────
function HeartRateTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { reading: SensorReading } }>;
}) {
  if (!active || !payload?.length) return null;
  const reading = payload[0].payload.reading;
  const bpm = reading.heartRate;

  const zone =
    bpm < 60
      ? { label: "Resting / Low", tone: "bg-blue-50 text-blue-700" }
      : bpm <= 100
      ? { label: "Normal Resting Range", tone: "bg-emerald-50 text-emerald-700" }
      : { label: "Elevated Rate", tone: "bg-rose-50 text-rose-700" };

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-md">
      <p className="text-[11px] font-medium text-slate-500">{formatFullDateTime(reading.capturedAt)}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-display text-2xl font-black text-rose-600">{bpm}</span>
        <span className="font-bold text-slate-500">BPM</span>
        <span className={cn("ml-auto rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase", zone.tone)}>
          {zone.label}
        </span>
      </div>
      <div className="mt-2 border-t border-slate-100 pt-1.5 flex items-center justify-between text-[11px] text-slate-500">
        <span>Stress Score: <strong className="text-slate-800">{reading.stressScore}/100</strong></span>
        <span className="capitalize">{reading.source}</span>
      </div>
    </div>
  );
}

// ── Heart Rate History Chart ────────────────────────────────────────────────
export function HeartRateHistoryChart({
  readings,
  timeRange,
  hasAnyData,
  onResetRange,
  onNavigateLive,
}: {
  readings: SensorReading[];
  timeRange: TimeRange;
  hasAnyData: boolean;
  onResetRange?: () => void;
  onNavigateLive?: () => void;
}) {
  const mounted = useIsMounted();
  const chartId = useId();

  const data = useMemo(() => {
    const sampled = downsampleReadings(readings, 240);
    return sampled.map((r) => ({
      reading: r,
      timestamp: r.capturedAt,
      timeLabel: formatChartTime(r.capturedAt, timeRange),
      heartRate: r.heartRate,
    }));
  }, [readings, timeRange]);

  const stats = useMemo(() => {
    if (!readings.length) return null;
    const rates = readings.map((r) => r.heartRate);
    const avg = Math.round(rates.reduce((sum, v) => sum + v, 0) / rates.length);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const latest = readings[readings.length - 1].heartRate;
    return { avg, min, max, latest };
  }, [readings]);

  if (!mounted) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-2xl bg-slate-50">
        <p className="text-xs text-sentinel-muted">Loading historical chart…</p>
      </div>
    );
  }

  if (readings.length === 0) {
    return (
      <ChartEmptyState
        timeRange={timeRange}
        hasAnyData={hasAnyData}
        onResetRange={onResetRange}
        onNavigateLive={onNavigateLive}
      />
    );
  }

  const gradientId = `heartRateGradient-${chartId.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div>
      {stats && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-lg bg-rose-50/70 px-2.5 py-1 text-rose-700">
            <span className="font-semibold text-rose-600/80">Average:</span>{" "}
            <strong className="font-bold">{stats.avg} BPM</strong>
          </div>
          <div className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
            <span className="text-slate-500">Range:</span>{" "}
            <strong>{stats.min} – {stats.max} BPM</strong>
          </div>
          <div className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
            <span className="text-slate-500">Latest in range:</span>{" "}
            <strong className="text-rose-600">{stats.latest} BPM</strong>
          </div>
        </div>
      )}

      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#eb5b69" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#eb5b69" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.7} />
            <XAxis
              dataKey="timeLabel"
              tickLine={false}
              axisLine={{ stroke: "#e2e8f0" }}
              tick={{ fontSize: 11, fill: "#64748b" }}
              minTickGap={32}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
              width={42}
            />
            <Tooltip content={<HeartRateTooltip />} />
            <ReferenceLine y={60} stroke="#94a3b8" strokeDasharray="2 2" strokeOpacity={0.7} />
            <ReferenceLine y={100} stroke="#f43f5e" strokeDasharray="2 2" strokeOpacity={0.7} />
            <Area
              type="monotone"
              dataKey="heartRate"
              stroke="#eb5b69"
              strokeWidth={2.5}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              dot={data.length <= 16 ? { r: 3, fill: "#eb5b69", strokeWidth: 1 } : false}
              activeDot={{ r: 5, fill: "#eb5b69", stroke: "#ffffff", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-rose-500" /> Heart Rate (BPM)
        </span>
        <span className="text-slate-400">Dashed lines mark typical 60–100 BPM resting range</span>
      </div>
    </div>
  );
}

// ── Stress Score Custom Tooltip ─────────────────────────────────────────────
function StressScoreTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { reading: SensorReading } }>;
}) {
  if (!active || !payload?.length) return null;
  const reading = payload[0].payload.reading;
  const score = reading.stressScore;

  const zone =
    score < 60
      ? { label: "Calm", tone: "bg-teal-50 text-teal-700" }
      : score < 80
      ? { label: "Elevated", tone: "bg-amber-50 text-amber-700" }
      : { label: "Crisis", tone: "bg-rose-50 text-rose-700" };

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-md">
      <p className="text-[11px] font-medium text-slate-500">{formatFullDateTime(reading.capturedAt)}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-display text-2xl font-black text-sentinel-teal">{score}</span>
        <span className="font-bold text-slate-500">/ 100</span>
        <span className={cn("ml-auto rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase", zone.tone)}>
          {zone.label}
        </span>
      </div>
      <div className="mt-2 border-t border-slate-100 pt-1.5 flex items-center justify-between text-[11px] text-slate-500">
        <span>Hardware Level: <strong className="text-slate-800">{reading.stressLevel || "RELAXED"}</strong></span>
        <span>Heart: <strong className="text-slate-800">{reading.heartRate} BPM</strong></span>
      </div>
    </div>
  );
}

// ── Stress Score History Chart ──────────────────────────────────────────────
export function StressScoreHistoryChart({
  readings,
  timeRange,
  hasAnyData,
  onResetRange,
  onNavigateLive,
}: {
  readings: SensorReading[];
  timeRange: TimeRange;
  hasAnyData: boolean;
  onResetRange?: () => void;
  onNavigateLive?: () => void;
}) {
  const mounted = useIsMounted();
  const chartId = useId();

  const data = useMemo(() => {
    const sampled = downsampleReadings(readings, 240);
    return sampled.map((r) => ({
      reading: r,
      timestamp: r.capturedAt,
      timeLabel: formatChartTime(r.capturedAt, timeRange),
      stressScore: r.stressScore,
    }));
  }, [readings, timeRange]);

  const stats = useMemo(() => {
    if (!readings.length) return null;
    const scores = readings.map((r) => r.stressScore);
    const avg = Math.round(scores.reduce((sum, v) => sum + v, 0) / scores.length);
    const min = Math.min(...scores);
    const peak = Math.max(...scores);
    const calmCount = scores.filter((s) => s < 60).length;
    const calmPct = Math.round((calmCount / scores.length) * 100);
    const latest = readings[readings.length - 1].stressScore;
    return { avg, min, peak, calmPct, latest };
  }, [readings]);

  if (!mounted) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-2xl bg-slate-50">
        <p className="text-xs text-sentinel-muted">Loading historical chart…</p>
      </div>
    );
  }

  if (readings.length === 0) {
    return (
      <ChartEmptyState
        timeRange={timeRange}
        hasAnyData={hasAnyData}
        onResetRange={onResetRange}
        onNavigateLive={onNavigateLive}
      />
    );
  }

  const gradientId = `stressScoreGradient-${chartId.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div>
      {stats && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-lg bg-teal-50/70 px-2.5 py-1 text-teal-800">
            <span className="font-semibold text-teal-700">Average:</span>{" "}
            <strong className="font-bold">{stats.avg} / 100</strong>
          </div>
          <div className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
            <span className="text-slate-500">Peak:</span>{" "}
            <strong className={stats.peak >= 80 ? "text-rose-600" : stats.peak >= 60 ? "text-amber-600" : "text-teal-700"}>
              {stats.peak} / 100
            </strong>
          </div>
          <div className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-800">
            <span className="text-emerald-600 font-semibold">Calm:</span>{" "}
            <strong>{stats.calmPct}% of time</strong>
          </div>
          <div className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
            <span className="text-slate-500">Latest in range:</span>{" "}
            <strong className="text-teal-700">{stats.latest} / 100</strong>
          </div>
        </div>
      )}

      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0c9488" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#0c9488" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.7} />
            <XAxis
              dataKey="timeLabel"
              tickLine={false}
              axisLine={{ stroke: "#e2e8f0" }}
              tick={{ fontSize: 11, fill: "#64748b" }}
              minTickGap={32}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
              width={42}
            />
            <Tooltip content={<StressScoreTooltip />} />
            <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.7} />
            <ReferenceLine y={80} stroke="#f43f5e" strokeDasharray="3 3" strokeOpacity={0.7} />
            <Area
              type="monotone"
              dataKey="stressScore"
              stroke="#0c9488"
              strokeWidth={2.5}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              dot={data.length <= 16 ? { r: 3, fill: "#0c9488", strokeWidth: 1 } : false}
              activeDot={{ r: 5, fill: "#0c9488", stroke: "#ffffff", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-sentinel-teal" /> Stress Score (0–100)
        </span>
        <span className="text-slate-400">Calm: 0–59 · Elevated: 60–79 · Crisis: 80+</span>
      </div>
    </div>
  );
}

// ── Offline Connection Banner ───────────────────────────────────────────────
export function ConnectionStatusBanner({
  isRtdbConnected,
  isOnline,
  storageStatus,
}: {
  isRtdbConnected: boolean;
  isOnline: boolean;
  storageStatus: string;
}) {
  if (isOnline && isRtdbConnected) return null;

  return (
    <div className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/90 p-4 text-xs text-amber-900 shadow-xs">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
        <AlertCircle className="size-4" />
      </span>
      <div className="flex-1">
        <p className="font-bold">
          {!isOnline
            ? "Browser Offline — Working with Local Cache"
            : "Connecting to Firebase Realtime Database…"}
        </p>
        <p className="mt-0.5 text-amber-800/80">
          Historical charts remain viewable using your local device history. New readings will automatically sync with cloud storage when connectivity is restored ({storageStatus}).
        </p>
      </div>
    </div>
  );
}
