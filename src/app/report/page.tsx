"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Navigation from "@/components/Navigation";
import { hasPremiumAccess } from "@/lib/billing";
import { createClient, isPaidPlan } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";
import { mergeWeightRecordsByDate } from "@/lib/merge-weight-records";

type Row = Record<string, any>;

const monthValue = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const numberValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const mergeProfileRows = (primary: Row | null, fallback: Row | null) => {
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

const formatMonth = (value: string) => {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
};

export default function ReportPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Row | null>(null);
  const [records, setRecords] = useState<Row[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(monthValue());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const [byId, byUserId, daily, weight] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("daily_records").select("*").eq("user_id", user.id).order("recorded_date", { ascending: true }).limit(400),
      supabase.from("weight_records").select("*").eq("user_id", user.id).order("recorded_date", { ascending: true }).limit(400),
    ]);

    const profileError = byId.error && byUserId.error ? byId.error : null;
    const recordsError = daily.error && weight.error ? daily.error : null;
    const error = profileError ?? recordsError;
    if (error) {
      setLoadError(
        getUserFacingError(
          error,
          "月次レポートを読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    setProfile(mergeProfileRows(byId.data, byUserId.data));
    setRecords(mergeWeightRecordsByDate(daily.data ?? [], weight.data ?? [], "asc"));
    setLoading(false);
  };

  const paid = hasPremiumAccess(profile?.plan_type, profile?.plan);

  const monthlyRecords = useMemo(
    () => records.filter((record) => String(record.recorded_date).startsWith(selectedMonth)),
    [records, selectedMonth]
  );

  const chartData = monthlyRecords.map((record) => ({
    date: Number(String(record.recorded_date).slice(8, 10)),
    weight: numberValue(record.weight_kg ?? record.weight),
    bodyFat: numberValue(record.body_fat_percentage),
  }));
  const weights = chartData.map((item) => item.weight).filter((value): value is number => value !== null);
  const bodyFats = chartData.map((item) => item.bodyFat).filter((value): value is number => value !== null);
  const weightChange = weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null;
  const bodyFatAverage = bodyFats.length
    ? bodyFats.reduce((sum, value) => sum + value, 0) / bodyFats.length
    : null;
  const latestWeight = weights.length ? weights[weights.length - 1] : null;

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <p className="text-sm font-bold text-[#5d9997]">振り返り</p>
          <h1 className="mt-1 text-3xl font-bold tracking-normal">月次レポート</h1>
          <p className="mt-2 text-base text-stone-400">月ごとの記録と変化をまとめます</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          {loading ? (
            <StateCard title="読み込み中..." text="記録を集計しています。" />
          ) : loadError ? (
            <StateCard title="読み込みに失敗しました" text={loadError}>
              <button
                type="button"
                onClick={loadData}
                className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white"
              >
                再読み込み
              </button>
            </StateCard>
          ) : !paid ? (
            <section className="overflow-hidden rounded-2xl bg-white shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <div className="bg-[#5d9997] p-5 text-white">
                <p className="text-sm font-bold text-white/70">有料プラン機能</p>
                <h2 className="mt-2 text-2xl font-bold">月ごとの変化をまとめて確認</h2>
                <p className="mt-2 text-sm leading-6 text-white/80">
                  記録回数、体重変化、平均体脂肪率をひとつの画面で振り返れます。
                </p>
              </div>
              <div className="p-5">
                <div className="rounded-2xl bg-teal-50 px-4 py-3">
                  <p className="text-sm font-bold text-slate-800">本格ファスティングAIプラン</p>
                  <p className="mt-1 text-sm font-bold text-[#5d9997]">月額1,980円</p>
                </div>
                <Link href="/premium" className="mt-4 block rounded-xl bg-slate-900 py-3 text-center text-base font-bold text-white">
                  機能と料金を見る
                </Link>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-600">表示する月</span>
                  <input
                    type="month"
                    value={selectedMonth}
                    max={monthValue()}
                    onChange={(event) => setSelectedMonth(event.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5d9997] focus:ring-2 focus:ring-teal-100"
                  />
                </label>
              </section>

              <section className="rounded-[22px] bg-[#5d9997] p-5 text-white shadow-sm">
                <p className="text-sm font-bold text-white/70">{formatMonth(selectedMonth)}のまとめ</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Summary label="記録日数" value={`${monthlyRecords.length}日`} />
                  <Summary label="最新体重" value={latestWeight === null ? "--" : `${latestWeight.toFixed(1)}kg`} />
                  <Summary
                    label="体重変化"
                    value={weightChange === null ? "--" : `${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)}kg`}
                  />
                  <Summary
                    label="平均体脂肪率"
                    value={bodyFatAverage === null ? "--" : `${bodyFatAverage.toFixed(1)}%`}
                  />
                </div>
              </section>

              {monthlyRecords.length === 0 ? (
                <StateCard title="この月の記録はありません" text="体重または体脂肪率を記録すると、月次レポートに反映されます。">
                  <Link href="/record" className="mt-4 block rounded-xl bg-[#5d9997] py-3 text-center text-sm font-bold text-white">
                    記録を追加する
                  </Link>
                </StateCard>
              ) : (
                <>
                  <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-bold">体重の推移</h2>
                      <span className="text-xs font-bold text-stone-400">日付 / kg</span>
                    </div>
                    {weights.length < 2 ? (
                      <div className="grid h-48 place-items-center text-center text-sm leading-6 text-stone-400">
                        体重を2日以上記録すると<br />推移が表示されます
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={230}>
                        <LineChart data={chartData} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid stroke="#eee7dc" strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                          <Tooltip
                            labelFormatter={(value) => `${selectedMonth.replace("-", "/")}/${value}`}
                            formatter={(value) => [`${value}kg`, "体重"]}
                          />
                          <Line type="monotone" dataKey="weight" stroke="#5d9997" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </section>

                  <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                    <h2 className="text-lg font-bold">今月の振り返り</h2>
                    <p className="mt-3 text-sm leading-7 text-stone-600">
                      {monthlyRecords.length < 4
                        ? "まだ記録が少ないため、変化を判断する段階ではありません。週に1〜2回でも続けると傾向が見えやすくなります。"
                        : weightChange === null
                          ? "体重の記録を増やすと、月初からの変化を確認できます。"
                          : Math.abs(weightChange) < 0.5
                            ? "体重は大きく変わらず安定しています。体調や睡眠も合わせて振り返りましょう。"
                            : weightChange < 0
                              ? "月初より体重が減っています。急な変化になっていないか、体調も一緒に確認してください。"
                              : "月初より体重が増えています。数字だけで判断せず、食事・睡眠・むくみの記録も見直しましょう。"}
                    </p>
                    <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-xs leading-5 text-stone-500">
                      この表示は記録の整理を目的としており、医療上の診断ではありません。
                    </p>
                  </section>
                </>
              )}
            </>
          )}
        </main>
      </div>

      <Navigation active="record" />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/15 p-4">
      <p className="text-xs font-bold text-white/65">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function StateCard({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <p className="text-base font-bold text-stone-600">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-400">{text}</p>
      {children}
    </section>
  );
}
