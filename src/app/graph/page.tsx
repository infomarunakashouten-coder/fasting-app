"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Navigation from "@/components/Navigation";
import { hasPremiumAccess } from "@/lib/billing";
import { mergeWeightRecordsByDate } from "@/lib/merge-weight-records";
import { createClient, isPaidPlan } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";
import {
  buildChartTicks,
  buildRecordChartData,
  chartPeriodLabels,
  formatChartTick,
  formatTooltipDate,
  getPeriodRange,
  type ChartPeriod,
} from "@/lib/records-chart";
import type { DailyRecord, Profile } from "@/types";

type ChartType = "weight" | "bodyFat";
type RecordRow = DailyRecord & Record<string, any>;

const periods: ChartPeriod[] = ["7", "30", "90", "365"];

const numberValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const mergeProfileRows = (
  primary: (Profile & Record<string, any>) | null,
  fallback: (Profile & Record<string, any>) | null
) => {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const merged = { ...primary };
  Object.entries(fallback).forEach(([key, value]) => {
    if (merged[key] === null || merged[key] === undefined || merged[key] === "") {
      merged[key] = value;
    }
  });
  return merged;
};

export default function GraphPage() {
  const router = useRouter();
  const supabase = createClient();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [profile, setProfile] = useState<(Profile & Record<string, any>) | null>(null);
  const [period, setPeriod] = useState<ChartPeriod>("30");
  const [activeChart, setActiveChart] = useState<ChartType>("weight");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      router.push("/auth/login");
      return;
    }

    const [
      { data: newRecords, error: newRecordsError },
      { data: oldRecords, error: oldRecordsError },
      { data: profileByNewId, error: profileByNewIdError },
      { data: profileByOldUserId, error: profileByOldUserIdError },
    ] =
      await Promise.all([
        supabase.from("daily_records").select("*").eq("user_id", user.id).order("recorded_date", { ascending: true }).limit(400),
        supabase.from("weight_records").select("*").eq("user_id", user.id).order("recorded_date", { ascending: true }).limit(400),
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      ]);

    const recordsError = newRecordsError && oldRecordsError ? newRecordsError : null;
    const profileError = profileByNewIdError && profileByOldUserIdError ? profileByNewIdError : null;
    const error = recordsError ?? profileError;
    if (error) {
      setLoadError(
        getUserFacingError(
          error,
          "グラフ情報を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    setRecords(mergeWeightRecordsByDate(newRecords ?? [], oldRecords ?? [], "asc"));
    setProfile(mergeProfileRows(profileByNewId, profileByOldUserId));
    setLoading(false);
  };

  const chartData = useMemo(() => buildRecordChartData(records, period), [records, period]);
  const chartTicks = useMemo(() => buildChartTicks(period), [period]);
  const chartRange = useMemo(() => getPeriodRange(period), [period]);

  const values = chartData
    .map((point) => (activeChart === "weight" ? point.weight : point.bodyFat))
    .map(numberValue)
    .filter((value): value is number => value !== null);
  const activeChartLabel = activeChart === "weight" ? "体重" : "体脂肪率";

  const stats = values.length
    ? {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((sum, value) => sum + value, 0) / values.length,
        change: values[values.length - 1] - values[0],
      }
    : null;

  const unit = activeChart === "weight" ? "kg" : "%";
  const targetWeight = numberValue(profile?.goal_weight_kg ?? profile?.goal_weight);
  const paid = hasPremiumAccess(profile?.plan_type, profile?.plan);

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <h1 className="text-2xl font-bold tracking-normal">詳細グラフ</h1>
          <p className="mt-2 text-base text-stone-400">体重・体脂肪率の推移</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          <section className="rounded-2xl bg-white p-4 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="grid grid-cols-4 gap-2">
              {periods.map((item) => (
                <button
                  key={item}
                  onClick={() => setPeriod(item)}
                  className={`rounded-xl py-2 text-[11px] font-bold transition ${
                    period === item ? "bg-[#5d9997] text-white" : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {chartPeriodLabels[item]}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 rounded-xl bg-stone-100 p-1">
              <button
                onClick={() => setActiveChart("weight")}
                className={`rounded-lg py-2 text-sm font-bold transition ${
                  activeChart === "weight" ? "bg-white text-[#4d8b8a] shadow-sm" : "text-stone-500"
                }`}
              >
                体重
              </button>
              <button
                onClick={() => setActiveChart("bodyFat")}
                className={`rounded-lg py-2 text-sm font-bold transition ${
                  activeChart === "bodyFat" ? "bg-white text-[#c9a35b] shadow-sm" : "text-stone-500"
                }`}
              >
                体脂肪率
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            {loading ? (
              <div className="grid h-64 place-items-center text-sm text-stone-400">読み込み中...</div>
            ) : loadError ? (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <p className="text-base font-bold text-red-700">読み込みに失敗しました</p>
                  <p className="mt-2 text-sm leading-6 text-stone-500">{loadError}</p>
                  <button
                    type="button"
                    onClick={loadData}
                    className="mt-4 rounded-xl bg-[#5d9997] px-6 py-3 text-sm font-bold text-white"
                  >
                    再読み込み
                  </button>
                </div>
              </div>
            ) : values.length < 2 ? (
              <div className="grid h-64 place-items-center text-center text-sm text-stone-400">
                {activeChartLabel}を2日以上記録すると
                <br />
                グラフが表示されます
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#eee7dc" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[chartRange.startTime, chartRange.endTime]}
                    ticks={chartTicks}
                    tickFormatter={(value) => formatChartTick(Number(value), period)}
                    tick={{ fontSize: 10, fill: "#a8a29e" }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 14,
                      border: "1px solid #eee7dc",
                      boxShadow: "0 12px 28px rgba(120,104,80,0.12)",
                    }}
                    labelFormatter={(value) => formatTooltipDate(Number(value), period)}
                    formatter={(value) => [`${value}${unit}`, activeChartLabel]}
                  />
                  {activeChart === "weight" && targetWeight && (
                    <ReferenceLine
                      y={targetWeight}
                      stroke="#c9a35b"
                      strokeDasharray="4 4"
                      label={{
                        value: `目標 ${targetWeight}kg`,
                        position: "insideTopRight",
                        fontSize: 10,
                        fill: "#a2782b",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey={activeChart === "weight" ? "weight" : "bodyFat"}
                    stroke={activeChart === "weight" ? "#5d9997" : "#c9a35b"}
                    strokeWidth={3}
                    dot={{ fill: activeChart === "weight" ? "#5d9997" : "#c9a35b", r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          {stats && (
            <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <h2 className="text-lg font-bold">{activeChartLabel}のまとめ</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="期間変化" value={`${stats.change >= 0 ? "+" : ""}${stats.change.toFixed(1)}${unit}`} />
                <Stat label="平均" value={`${stats.avg.toFixed(1)}${unit}`} />
                <Stat label="最小" value={`${stats.min.toFixed(1)}${unit}`} />
                <Stat label="最大" value={`${stats.max.toFixed(1)}${unit}`} />
              </div>
            </section>
          )}

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#5d9997]">月ごとの振り返り</p>
                <h2 className="mt-1 text-lg font-bold">月次レポート</h2>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  記録日数、体重変化、平均体脂肪率を月単位で確認できます。
                </p>
              </div>
              {!paid && (
                <span className="shrink-0 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-500">
                  有料
                </span>
              )}
            </div>
            <Link
              href={paid ? "/report" : "/premium"}
              className="mt-4 block rounded-xl bg-[#5d9997] py-3 text-center text-sm font-bold text-white"
            >
              {paid ? "月次レポートを開く" : "機能と料金を見る"}
            </Link>
          </section>
        </main>
      </div>

      <Navigation active="record" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-stone-50 p-4">
      <p className="text-sm font-bold text-stone-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-[#4d8b8a]">{value}</p>
    </div>
  );
}
