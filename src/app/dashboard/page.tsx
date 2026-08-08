"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Navigation from "@/components/Navigation";
import { BILLING_ENABLED, PREMIUM_PRICE_LABEL, hasPremiumAccess } from "@/lib/billing";
import { getLatestVisibleFastingPlan } from "@/lib/fasting-plan";
import { mergeWeightRecordsByDate } from "@/lib/merge-weight-records";
import { getProfileCurrentWeight } from "@/lib/profile-weight";
import { createClient, getBMICategory, getTodayString, isPaidPlan } from "@/lib/supabase";
import {
  getSubscriptionPeriodEnd,
  hasPendingDowngrade,
  readPendingDowngrade,
} from "@/lib/subscription";
import { getUserFacingError } from "@/lib/user-facing-error";
import { buildProfileWeightUpdate, saveWeightRecord } from "@/lib/weight-records";
import { type DailyRecord, type FastingPlan, type Profile } from "@/types";

const formatDate = (date = new Date()) =>
  date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const localDate = (date: string) => new Date(`${date}T00:00:00`);

const addDays = (date: string, days: number) => {
  const next = localDate(date);
  next.setDate(next.getDate() + days);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0"),
  ].join("-");
};

const formatPlanDate = (date: string | null | undefined) => {
  if (!date) return "未設定";
  return localDate(date).toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
};

const getPlanDays = (plan: (FastingPlan & Record<string, any>) | null) => {
  if (!plan) return { prep: 0, main: 0, recovery: 0, total: 0 };

  const prep = Math.max(Number(plan.prep_days ?? 0), 0);
  const main = Math.max(Number(plan.main_days ?? 0), 0);
  const recovery = Math.max(Number(plan.recovery_days ?? 0), 0);
  const customTotal = prep + main + recovery;
  if (prep > 0 && main > 0 && recovery > 0 && customTotal > 0) {
    return { prep, main, recovery, total: customTotal };
  }

  if (plan.duration_days) {
    const duration = Number(plan.duration_days);
    if (duration === 3) return { prep: 1, main: 1, recovery: 1, total: 3 };
    if (duration === 5) return { prep: 1, main: 2, recovery: 2, total: 5 };
    if (duration === 7) return { prep: 2, main: 2, recovery: 3, total: 7 };
  }

  return { prep: 1, main: 1, recovery: 1, total: 3 };
};

const getFastingPhase = (plan: (FastingPlan & Record<string, any>) | null, today: string) => {
  if (!plan?.start_date) {
    return {
      label: "未設定",
      description: "ファスティング計画を作成すると、ここに予定が表示されます。",
      action: "開始日と期間を決める",
      buttonLabel: "計画を作る",
      day: 0,
      progress: 0,
    };
  }

  const days = getPlanDays(plan);
  const elapsed = Math.floor((localDate(today).getTime() - localDate(plan.start_date).getTime()) / 86400000);

  if (elapsed < 0) {
    const remaining = Math.abs(elapsed);
    return {
      label: "開始前",
      description: `開始まであと${remaining}日です。食事を軽く整えて準備しましょう。`,
      action: "油ものや甘いものを控え、睡眠時間を確保する",
      buttonLabel: "準備内容を見る",
      day: 0,
      progress: 0,
    };
  }
  if (elapsed >= days.total) {
    return {
      label: "終了",
      description: "おつかれさまでした。体重と体調の変化を振り返りましょう。",
      action: "記録を振り返り、回復食を急がず続ける",
      buttonLabel: "記録を振り返る",
      day: days.total,
      progress: 100,
    };
  }
  if (elapsed < days.prep) {
    return {
      label: "準備期",
      description: "脂っこいものや甘いものを控えて、本番に備えます。",
      action: "腹八分目と水分補給を意識する",
      buttonLabel: "今日の体調を記録",
      day: elapsed + 1,
      progress: ((elapsed + 1) / days.total) * 100,
    };
  }
  if (elapsed < days.prep + days.main) {
    return {
      label: "本番期",
      description: "水分をとりながら、無理のない範囲で進めましょう。",
      action: "水分と体調を確認し、つらい時は無理をしない",
      buttonLabel: "今日の体調を記録",
      day: elapsed + 1,
      progress: ((elapsed + 1) / days.total) * 100,
    };
  }
  return {
    label: "回復期",
    description: "胃腸にやさしい食事から少しずつ戻します。",
    action: "重湯やおかゆなど、少量の回復食から始める",
    buttonLabel: "回復食ガイドを見る",
    day: elapsed + 1,
    progress: ((elapsed + 1) / days.total) * 100,
  };
};

const avatarPathFromSeed = (seed: unknown) => {
  if (typeof seed !== "string") return null;
  const normalized = seed.replace("mio", "").padStart(2, "0");
  return /^\d{2}$/.test(normalized) ? `/avatar_${normalized}.png` : null;
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

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const today = getTodayString();

  const [profile, setProfile] = useState<(Profile & Record<string, any>) | null>(null);
  const [records, setRecords] = useState<Array<DailyRecord & Record<string, any>>>([]);
  const [plan, setPlan] = useState<(FastingPlan & Record<string, any>) | null>(null);
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [avatarPath, setAvatarPath] = useState("/avatar_01.png");
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);

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
      router.push("/auth/login");
      return;
    }

    const [
      { data: profileByNewId, error: profileByNewIdError },
      { data: profileByOldUserId, error: profileByOldUserIdError },
      { data: recordData, error: recordError },
      { data: oldRecordData, error: oldRecordError },
      { data: planData, error: planError },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("daily_records")
        .select("*")
        .eq("user_id", user.id)
        .order("recorded_date", { ascending: false })
        .limit(30),
      supabase
        .from("weight_records")
        .select("*")
        .eq("user_id", user.id)
        .order("recorded_date", { ascending: false })
        .limit(30),
      supabase
        .from("fasting_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const profileError = profileByNewIdError && profileByOldUserIdError ? profileByNewIdError : null;
    const recordsError = recordError && oldRecordError ? recordError : null;
    const error = profileError ?? recordsError ?? planError;
    if (error) {
      setLoadError(
        getUserFacingError(
          error,
          "ホーム情報を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    const profileData = mergeProfileRows(profileByNewId, profileByOldUserId);
    if (!profileData) {
      router.push("/profile/setup");
      return;
    }

    const sourceRecords = mergeWeightRecordsByDate(recordData ?? [], oldRecordData ?? []);
    const todayRecord = sourceRecords.find((record) => record.recorded_date === today);

    setProfile(profileData);
    setCancelAtPeriodEnd(hasPendingDowngrade(profileData, readPendingDowngrade()));
    setAvatarPath(
      profileData?.avatar_path ??
        profileData?.avatar_url ??
        profileData?.avatar ??
        avatarPathFromSeed(profileData?.avatar_seed) ??
        (typeof window !== "undefined" ? window.localStorage.getItem("fastingAvatarPath") : null) ??
        "/avatar_01.png"
    );
    setRecords(sourceRecords);
    setPlan(getLatestVisibleFastingPlan(planData));
    setWeight((todayRecord?.weight_kg ?? todayRecord?.weight ?? "").toString());
    setBodyFat((todayRecord?.body_fat_percentage ?? "").toString());
    setLoading(false);
  };

  const handleSave = async () => {
    if (!weight && !bodyFat) {
      setMessage("体重または体脂肪率を入力してください");
      return;
    }

    const weightNumber = weight ? Number(weight) : null;
    const bodyFatNumber = bodyFat ? Number(bodyFat) : null;

    if (weightNumber !== null && (!Number.isFinite(weightNumber) || weightNumber <= 0 || weightNumber > 500)) {
      setMessage("体重の数値を確認してください");
      return;
    }
    if (bodyFatNumber !== null && (!Number.isFinite(bodyFatNumber) || bodyFatNumber < 0 || bodyFatNumber > 100)) {
      setMessage("体脂肪率は0から100の範囲で入力してください");
      return;
    }

    setSaving(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      router.push("/auth/login");
      return;
    }

    const result = await saveWeightRecord({
      supabase,
      userId: user.id,
      recordedDate: today,
      weight: weightNumber,
      bodyFat: bodyFatNumber,
    });

    const updateProfileWeight = async () => {
      const update = buildProfileWeightUpdate(result.weight, result.bodyFat);
      if (Object.keys(update).length === 0) return null;

      const byId = await supabase.from("profiles").update(update).eq("id", user.id);
      const byUserId = await supabase.from("profiles").update(update).eq("user_id", user.id);
      return byId.error && byUserId.error ? byId.error : null;
    };

    if (result.succeeded) {
      await updateProfileWeight();
    }

    setSaving(false);

    if (!result.succeeded) {
      setMessage(
        getUserFacingError(
          result.newError ?? result.oldError,
          "保存できませんでした。時間をおいてもう一度お試しください。",
          {
            duplicateMessage:
              "今日の記録を更新できませんでした。画面を再読み込みしてお試しください。",
          }
        )
      );
      return;
    }

    setMessage("保存しました");
    loadData();
  };

  const latestRecord = records[0];
  const currentWeight =
    toNumber(latestRecord?.weight_kg) ??
    toNumber(latestRecord?.weight) ??
    getProfileCurrentWeight(profile);
  const targetWeight = toNumber(profile?.goal_weight_kg) ?? toNumber(profile?.goal_weight);
  const heightCm = toNumber(profile?.height_cm) ?? toNumber(profile?.height);
  const heightM = heightCm ? heightCm / 100 : null;
  const bmi = currentWeight && heightM ? currentWeight / (heightM * heightM) : null;
  const targetDiff = currentWeight && targetWeight ? Math.max(currentWeight - targetWeight, 0) : null;
  const paid = hasPremiumAccess(profile?.plan_type, profile?.plan);
  const paidUntil = getSubscriptionPeriodEnd(profile);
  const fastingDays = getPlanDays(plan);
  const fastingPhase = getFastingPhase(plan, today);
  const fastingEndDate =
    plan?.start_date && fastingDays.total > 0
      ? addDays(plan.start_date, fastingDays.total - 1)
      : null;

  const chartData = useMemo(
    () =>
      [...records]
        .reverse()
        .slice(-14)
        .map((record) => ({
          date: new Date(`${record.recorded_date}T00:00:00`).toLocaleDateString("ja-JP", {
            month: "numeric",
            day: "numeric",
          }),
          weight: record.weight_kg ?? record.weight,
          bodyFat: record.body_fat_percentage,
        })),
    [records]
  );
  const chartWeightCount = chartData.filter((point) => toNumber(point.weight) !== null).length;
  const chartBodyFatCount = chartData.filter((point) => toNumber(point.bodyFat) !== null).length;
  const hasChartSeries = chartWeightCount >= 2 || chartBodyFatCount >= 2;

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-normal">ホーム</h1>
              <p className="mt-2 text-base text-stone-400">ファスティング記録アプリ</p>
            </div>
            <span className={`mt-1 shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
              paid ? "bg-[#669a9a] text-white" : "bg-stone-100 text-stone-500"
            }`}>
              {paid && cancelAtPeriodEnd ? "変更予約中" : paid ? "本格プラン" : "無料プラン"}
            </span>
          </div>
        </header>

        <main className="space-y-5 px-5 py-6">
          {loading ? (
            <StateCard title="読み込み中..." description="今日の記録とプラン情報を確認しています。" />
          ) : loadError ? (
            <StateCard title="読み込みに失敗しました" description={loadError}>
              <button
                type="button"
                onClick={loadData}
                className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white"
              >
                再読み込み
              </button>
            </StateCard>
          ) : (
            <>
          <section className="rounded-[22px] bg-[#5d9997] px-6 py-7 text-white shadow-sm">
            <div className="flex items-center gap-5">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white bg-[#f2eadf] text-5xl shadow-sm">
                {avatarPath.startsWith("/") ? (
                  <img src={avatarPath} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span>{avatarPath}</span>
                )}
              </div>
              <div>
                <p className="text-lg font-bold text-white/75">こんにちは</p>
                <p className="mt-1 text-4xl font-light tracking-normal">{profile?.nickname ?? "ゲスト"} さん</p>
                <p className="mt-3 text-lg font-bold text-white/65">{formatDate()}</p>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <p className="text-sm font-bold text-stone-400">現在の体重</p>
              <p className="mt-2 text-4xl font-light text-[#4d8b8a]">
                {currentWeight ? currentWeight.toFixed(1) : "--"}
              </p>
              <p className="text-base text-stone-400">kg</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <p className="text-sm font-bold text-stone-400">BMI</p>
              <p className="mt-2 text-4xl font-light text-[#4d8b8a]">{bmi ? bmi.toFixed(1) : "--"}</p>
              <p className="text-base text-stone-400">{bmi ? getBMICategory(bmi).label : ""}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <p className="text-sm font-bold text-stone-400">目標体重</p>
              <p className="mt-2 text-4xl font-light text-[#4d8b8a]">
                {targetWeight ? targetWeight.toFixed(targetWeight % 1 ? 1 : 0) : "--"}
              </p>
              <p className="text-base text-stone-400">kg</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <p className="text-sm font-bold text-stone-400">目標まで</p>
              <p className="mt-2 text-4xl font-light text-[#4d8b8a]">
                {targetDiff === null ? "--" : targetDiff.toFixed(1)}
              </p>
              <p className="text-base text-stone-400">kg</p>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl bg-white shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="bg-[#5d9997] p-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white/70">ファスティング予定</p>
                  <h2 className="mt-2 text-3xl font-light">{fastingPhase.label}</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-white/75">{fastingPhase.description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-white/15 px-3 py-2 text-sm font-bold">
                  {fastingDays.total ? `${fastingPhase.day}/${fastingDays.total}日` : "未設定"}
                </span>
              </div>
              <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white" style={{ width: `${fastingPhase.progress}%` }} />
              </div>
              {fastingDays.total > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-bold text-white/80">
                  <div className="rounded-2xl bg-white/15 px-2 py-3">準備 {fastingDays.prep}日</div>
                  <div className="rounded-2xl bg-white/15 px-2 py-3">本番 {fastingDays.main}日</div>
                  <div className="rounded-2xl bg-white/15 px-2 py-3">回復 {fastingDays.recovery}日</div>
                </div>
              )}
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-bold text-stone-400">開始日</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">{formatPlanDate(plan?.start_date)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-stone-400">終了予定</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">{formatPlanDate(fastingEndDate)}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-3">
                <p className="text-xs font-bold text-[#5d9997]">今日の目安</p>
                <p className="mt-1 text-sm font-bold leading-6 text-slate-700">{fastingPhase.action}</p>
              </div>
              <Link href="/fasting" className="block rounded-xl bg-[#5d9997] py-3 text-center text-sm font-bold text-white">
                {fastingPhase.buttonLabel}
              </Link>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">今日の入力</h2>
                <p className="text-sm text-stone-400">無料プランでも毎日使えます</p>
              </div>
              <Link href="/record" className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-[#5d9997]">
                履歴
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-600">体重 kg</span>
                <input
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  inputMode="decimal"
                  type="number"
                  step="0.1"
                  className="w-full rounded-xl border border-stone-200 px-4 py-3 text-xl font-bold text-slate-700 outline-none focus:border-[#5d9997] focus:ring-2 focus:ring-teal-100"
                  placeholder="54.5"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-600">体脂肪率 %</span>
                <input
                  value={bodyFat}
                  onChange={(event) => setBodyFat(event.target.value)}
                  inputMode="decimal"
                  type="number"
                  step="0.1"
                  className="w-full rounded-xl border border-stone-200 px-4 py-3 text-xl font-bold text-slate-700 outline-none focus:border-[#5d9997] focus:ring-2 focus:ring-teal-100"
                  placeholder="24.0"
                />
              </label>
            </div>

            {message && (
              <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${
                message.includes("失敗") ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-700"
              }`}>
                {message}
              </p>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white shadow-sm disabled:opacity-60"
            >
              {saving ? "保存中..." : "今日の記録を保存"}
            </button>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">14日間の推移</h2>
              <Link href="/graph" className="text-sm font-bold text-[#5d9997]">
                詳細グラフ
              </Link>
            </div>
            {!hasChartSeries ? (
              <div className="grid h-40 place-items-center text-center text-sm text-stone-400">
                体重または体脂肪率を2日以上記録すると
                <br />
                グラフが表示されます
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData} margin={{ left: -20, right: 4, top: 10, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  {chartWeightCount >= 2 && (
                    <Line type="monotone" dataKey="weight" stroke="#5d9997" strokeWidth={3} dot={false} name="体重" connectNulls={false} />
                  )}
                  {chartBodyFatCount >= 2 && (
                    <Line type="monotone" dataKey="bodyFat" stroke="#c9a35b" strokeWidth={3} dot={false} name="体脂肪率" connectNulls={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-stone-400">現在のプラン</p>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  {paid ? "本格ファスティングAIプラン" : "体重管理プラン"}
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {paid
                    ? BILLING_ENABLED
                      ? PREMIUM_PRICE_LABEL
                      : "試用版（請求なし）"
                    : "無料"}
                </p>
                {paid && cancelAtPeriodEnd && (
                  <p className="mt-2 text-sm font-bold text-amber-700">
                    {paidUntil
                      ? `${formatPlanDate(paidUntil)}まで利用できます`
                      : "次回更新日まで利用できます"}
                  </p>
                )}
              </div>
              <Link href="/settings" className="shrink-0 rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-[#5d9997]">
                管理
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href="/fasting" className="rounded-xl bg-stone-50 px-3 py-3 text-center text-sm font-bold text-slate-600">
                ファスティング
              </Link>
              <Link
                href={paid ? "/report" : "/premium"}
                className="rounded-xl bg-teal-50 px-3 py-3 text-center text-sm font-bold text-[#4d8b8a]"
              >
                {paid ? "月次レポート" : "有料機能を見る"}
              </Link>
            </div>
          </section>
            </>
          )}
        </main>
      </div>

      <Navigation active="dashboard" />
    </div>
  );
}

function StateCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <p className="text-base font-bold text-slate-800">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-500">{description}</p>
      {children}
    </section>
  );
}
