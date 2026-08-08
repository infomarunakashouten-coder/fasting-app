"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import {
  BILLING_ENABLED,
  PREMIUM_PRICE,
  hasPremiumAccess,
  premiumPriceDisplay,
} from "@/lib/billing";
import { getFastingEligibility } from "@/lib/fasting-eligibility";
import { getProfileCurrentWeight } from "@/lib/profile-weight";
import { calcBMI, createClient, isPaidPlan } from "@/lib/supabase";
import {
  getSubscriptionPeriodEnd,
  hasPendingDowngrade,
  readPendingDowngrade,
} from "@/lib/subscription";
import { getUserFacingError } from "@/lib/user-facing-error";

const PREMIUM_FEATURES = [
  {
    icon: "📅",
    title: "ファスティングスケジュール",
    description: "準備期・本番期・回復期を、体調や生活リズムに合わせて組み立てます。",
    href: "/fasting",
    availability: "available",
  },
  {
    icon: "🥣",
    title: "回復食ガイド",
    description: "ファスティング後の食事を、胃腸にやさしい順番で確認できます。",
    href: "/fasting",
    availability: "available",
  },
  {
    icon: "✨",
    title: "AI提案プレビュー",
    description: "体調記録をもとにした今日のヒントを確認できます。写真AI判定は準備中です。",
    href: "/fasting",
    availability: "preview",
  },
  {
    icon: "📝",
    title: "詳細体調記録",
    description: "水分、睡眠、空腹感、むくみ、体調メモを細かく残せます。",
    href: "/fasting",
    availability: "available",
  },
  {
    icon: "📊",
    title: "レポート",
    description: "体重・体脂肪率・記録傾向を月ごとに振り返れます。",
    href: "/report",
    availability: "available",
  },
];

const COMPARISON = [
  { name: "体重・体脂肪率の記録", free: "○", premium: "○" },
  { name: "グラフ表示", free: "○", premium: "○" },
  { name: "ひろばの閲覧", free: "○", premium: "○" },
  { name: "ひろばへの投稿", free: "-", premium: "○" },
  { name: "ファスティング計画", free: "-", premium: "○" },
  { name: "詳細体調記録", free: "-", premium: "○" },
  { name: "回復食ガイド", free: "-", premium: "○" },
  { name: "AI提案", free: "-", premium: "先行版" },
  { name: "写真AI判定", free: "-", premium: "準備中" },
  { name: "月次レポート", free: "-", premium: "○" },
];

function formatDate(value: string) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const mergeProfileRows = (primary: Record<string, any> | null, fallback: Record<string, any> | null) => {
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

export default function PremiumPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadProfile = async () => {
    setLoading(true);
    setLoadError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const [byId, byUserId, latestNewRecord, latestOldRecord] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("daily_records")
        .select("weight_kg,recorded_date")
        .eq("user_id", user.id)
        .not("weight_kg", "is", null)
        .order("recorded_date", { ascending: false })
        .limit(1),
      supabase
        .from("weight_records")
        .select("weight,recorded_date")
        .eq("user_id", user.id)
        .not("weight", "is", null)
        .order("recorded_date", { ascending: false })
        .limit(1),
    ]);

    if (byId.error && byUserId.error) {
      setLoadError(
        getUserFacingError(
          byId.error,
          "プラン情報を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    const mergedProfile = mergeProfileRows(byId.data, byUserId.data);
    if (!mergedProfile) {
      router.push("/profile/setup");
      return;
    }

    const latestRecordedWeight = Number(
      latestNewRecord.data?.[0]?.weight_kg ?? latestOldRecord.data?.[0]?.weight
    );
    if (
      getProfileCurrentWeight(mergedProfile) === null &&
      Number.isFinite(latestRecordedWeight) &&
      latestRecordedWeight > 0
    ) {
      mergedProfile.current_weight_kg = latestRecordedWeight;
    }

    setProfile({
      ...mergedProfile,
      cancel_at_period_end: hasPendingDowngrade(
        {
          cancel_at_period_end:
            byId.data?.cancel_at_period_end || byUserId.data?.cancel_at_period_end,
          subscription_cancel_at_period_end:
            byId.data?.subscription_cancel_at_period_end ||
            byUserId.data?.subscription_cancel_at_period_end,
        },
        readPendingDowngrade()
      ),
    });
    setLoading(false);
  };

  useEffect(() => {
    loadProfile();

    const refreshProfile = () => loadProfile();
    window.addEventListener("pageshow", refreshProfile);
    window.addEventListener("focus", refreshProfile);

    return () => {
      window.removeEventListener("pageshow", refreshProfile);
      window.removeEventListener("focus", refreshProfile);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paid = useMemo(
    () => hasPremiumAccess(profile?.plan_type, profile?.plan),
    [profile]
  );
  const nextBillingDate = getSubscriptionPeriodEnd(profile) ?? "";
  const cancelAtPeriodEnd = hasPendingDowngrade(profile);
  const formattedBillingDate = nextBillingDate ? formatDate(nextBillingDate) : "";
  const height = Number(profile?.height_cm ?? profile?.height);
  const weight = getProfileCurrentWeight(profile);
  const bmi =
    Number.isFinite(height) && height > 0 && weight !== null
      ? calcBMI(weight, height)
      : null;
  const age =
    profile?.age !== null && profile?.age !== undefined && Number.isFinite(Number(profile.age))
      ? Number(profile.age)
      : null;
  const fastingEligibility = getFastingEligibility({
    bmi,
    age,
    birthDate: profile?.birth_date,
  });

  return (
    <div className="min-h-screen bg-[#f5f1eb] pb-24 text-slate-950">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <p className="text-sm font-bold text-[#5d9997]">プラン</p>
          <h1 className="mt-1 text-3xl font-bold tracking-normal">プランと機能</h1>
          <p className="mt-2 text-base text-stone-400">料金と使える機能を確認できます</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          {!BILLING_ENABLED && (
            <section className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm leading-6 text-teal-800">
              <p className="font-bold">現在は試用版です</p>
              <p>プランを切り替えても料金は請求されません。正式な決済開始前に改めてご案内します。</p>
            </section>
          )}
          {loadError ? (
            <section className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <p className="text-base font-bold text-red-700">読み込みに失敗しました</p>
              <p className="mt-2 text-sm leading-6 text-stone-500">{loadError}</p>
              <button
                type="button"
                onClick={loadProfile}
                className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white"
              >
                再読み込み
              </button>
            </section>
          ) : (
            <>
          <section className="rounded-[22px] bg-[#5d9997] p-5 text-white shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white/70">現在のプラン</p>
                <h2 className="mt-2 text-xl font-bold leading-8">
                  {loading ? "確認中..." : paid ? "本格ファスティングAIプラン" : "体重管理プラン"}
                </h2>
              </div>
              <span className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-bold">
                {paid ? (cancelAtPeriodEnd ? "変更予約中" : "利用中") : "無料"}
              </span>
            </div>
            <div className="mt-3 flex items-end gap-2">
              <p className="text-4xl font-light">{paid ? PREMIUM_PRICE.toLocaleString("ja-JP") : "0"}</p>
              <p className="pb-1 text-base font-bold text-white/80">
                {paid && !BILLING_ENABLED ? "円 / 月（予定）" : "円 / 月"}
              </p>
            </div>
            {paid && !BILLING_ENABLED && (
              <p className="mt-2 text-xs font-bold text-white/75">{premiumPriceDisplay}・現在は請求なし</p>
            )}
            <p className="mt-4 text-sm leading-6 text-white/80">
              {paid
                ? cancelAtPeriodEnd
                  ? "ダウングレード予約済みです。期日までは有料機能を利用できます。"
                  : "ファスティング計画、詳細体調記録、回復食ガイド、月次レポートを利用できます。"
                : "体重記録、グラフ、ひろばの閲覧が使えます。有料プランではファスティング計画や月次レポートも使えます。"}
            </p>
            {BILLING_ENABLED && paid && formattedBillingDate ? (
              <div className="mt-4 rounded-2xl bg-white/12 p-4 text-sm leading-6 text-white/85">
                <p className="font-bold">
                  {cancelAtPeriodEnd ? "有料機能の利用期限" : "次回決済日"}: {formattedBillingDate}
                </p>
                <p>
                  {cancelAtPeriodEnd
                    ? "この日までは有料機能を使え、その後は無料プランへ変わります。"
                    : "前日までにダウングレードすると、次回以降の請求を停止できます。"}
                </p>
              </div>
            ) : null}
            <Link
              href="/settings#plan-management"
              className="mt-5 block rounded-2xl bg-white py-4 text-center text-base font-bold text-[#4d8b8a]"
            >
              {paid ? "プラン管理へ" : "本格プランを試す"}
            </Link>
          </section>

          {!fastingEligibility.eligible && !loading && (
            <section className="rounded-[22px] border border-amber-200 bg-amber-50 p-5">
              <p className="text-sm font-bold text-amber-700">本格プランの利用条件</p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">現在はファスティング機能を利用できません</h2>
              <p className="mt-2 text-sm leading-7 text-amber-900">{fastingEligibility.reason}</p>
              <p className="mt-2 text-xs leading-5 text-amber-700">
                成人かつBMI 18.5以上であることをアプリ内の最低条件としています。
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={loadProfile}
                  className="rounded-xl bg-white py-3 text-center text-sm font-bold text-amber-900"
                >
                  再判定する
                </button>
                <Link href="/settings#profile-settings" className="rounded-xl bg-white py-3 text-center text-sm font-bold text-amber-900">
                  登録情報を編集
                </Link>
              </div>
            </section>
          )}

          {fastingEligibility.eligible && !paid && !loading && (
            <section className="rounded-[22px] border border-teal-200 bg-teal-50 p-5">
              <p className="text-sm font-bold text-teal-700">利用条件を確認できました</p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">本格プランをお試しいただけます</h2>
              <p className="mt-2 text-sm leading-7 text-teal-900">
                現在は試用版のため料金は発生しません。プラン管理で切り替えると、ファスティング計画を作成できます。
              </p>
              <Link href="/settings#plan-management" className="mt-4 block rounded-xl bg-white py-3 text-center text-sm font-bold text-teal-800">
                プラン管理へ
              </Link>
            </section>
          )}

          <section className="rounded-[22px] bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-xl font-bold">
              {paid ? (cancelAtPeriodEnd ? "期限まで利用できる機能" : "利用できる機能") : "ロック中の機能"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-400">
              {paid
                ? cancelAtPeriodEnd
                  ? "無料プランへ変わる日までは、現在の有料機能をそのまま使えます。"
                  : "現在のプランで使える機能です。AI連携など一部は段階的に準備中です。"
                : "無料プランでは一部の機能がロックされています。"}
            </p>
            <div className="mt-4 space-y-3">
              {PREMIUM_FEATURES.map((feature) => (
                <article key={feature.title} className="flex gap-3 rounded-2xl bg-stone-50 p-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-2xl">
                    {feature.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold">{feature.title}</h3>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                          !paid
                            ? "bg-rose-50 text-rose-500"
                            : feature.availability === "preview"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-teal-50 text-[#4d8b8a]"
                        }`}
                      >
                        {!paid ? "ロック" : feature.availability === "preview" ? "先行版" : "利用可能"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-stone-500">{feature.description}</p>
                    {paid && (
                      <Link href={feature.href} className="mt-2 inline-block text-sm font-bold text-[#5d9997]">
                        開く
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-[22px] bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-xl font-bold">プラン比較</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-stone-100">
              <div className="grid grid-cols-[1fr_64px_64px] bg-stone-50 px-4 py-3 text-xs font-bold text-stone-400">
                <span>機能</span>
                <span className="text-center">無料</span>
                <span className="text-center">有料</span>
              </div>
              {COMPARISON.map((row) => (
                <div
                  key={row.name}
                  className="grid grid-cols-[1fr_64px_64px] border-t border-stone-100 px-4 py-3 text-sm"
                >
                  <span className="font-bold text-stone-600">{row.name}</span>
                  <span className="text-center text-stone-400">{row.free}</span>
                  <span className={`text-center font-bold ${
                    row.premium === "準備中" ? "text-stone-400" : row.premium === "先行版" ? "text-amber-700" : "text-[#5d9997]"
                  }`}>
                    {row.premium}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <Link
            href="/settings#plan-management"
            className="block rounded-2xl bg-white py-4 text-center text-base font-bold text-[#4d8b8a] shadow-[0_12px_28px_rgba(120,104,80,0.08)]"
          >
            プラン管理へ
          </Link>
            </>
          )}
        </main>
      </div>

      <Navigation active="premium" />
    </div>
  );
}
