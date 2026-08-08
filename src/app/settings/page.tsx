"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { BILLING_ENABLED, premiumPriceDisplay } from "@/lib/billing";
import { getFastingEligibility, getMinimumWeightForBmi } from "@/lib/fasting-eligibility";
import { validateProfileFields } from "@/lib/profile-validation";
import { getProfileCurrentWeight } from "@/lib/profile-weight";
import { createClient, getBMICategory, getTodayString } from "@/lib/supabase";
import {
  DOWNGRADE_STORAGE_KEY,
  getSubscriptionPeriodEnd,
  hasPendingDowngrade,
  readPendingDowngrade,
  savePendingDowngrade,
} from "@/lib/subscription";
import { getUserFacingError, isMissingDatabaseObjectError } from "@/lib/user-facing-error";
import { saveWeightRecord } from "@/lib/weight-records";
import type { Gender } from "@/types";

type ProfileRow = Record<string, any>;
type ProfileSource = "new" | "old";
type PlanAction = "upgrade" | "downgrade" | "resume" | null;
type SecurityStatus = {
  configured: boolean;
  accountDeletionReady: boolean;
  feedbackReady: boolean;
};

const AVATARS = Array.from({ length: 10 }, (_, index) => {
  const seed = String(index + 1).padStart(2, "0");
  return { seed, path: `/avatar_${seed}.png` };
});

const inputClass =
  "w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50";

const labelClass = "mb-2 block text-sm font-bold text-slate-600";

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const calcBmi = (weight: number | null, heightCm: number | null) => {
  if (!weight || !heightCm) return null;
  const heightM = heightCm / 100;
  return weight / (heightM * heightM);
};

const bmiLabel = (bmi: number | null) => {
  if (!bmi) return "未計算";
  return getBMICategory(bmi).label;
};

const avatarPathFromSeed = (seed: unknown) => {
  if (seed == null) return null;
  const normalized = String(seed).replace("mio", "").padStart(2, "0");
  return /^\d{2}$/.test(normalized) ? `/avatar_${normalized}.png` : null;
};

const avatarSeedFromPath = (path: string) => path.match(/avatar_(\d{2})\.png/)?.[1] ?? "01";

const calculateAge = (birthDate: string) => {
  if (!birthDate) return "";
  const birthday = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birthday.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) age -= 1;
  return age >= 0 ? String(age) : "";
};

const planLabel = (paid: boolean) => (paid ? "本格ファスティングAIプラン" : "体重管理プラン");

const PLAN_OPTIONS = [
  {
    id: "free",
    name: "体重管理プラン",
    price: "無料",
    description: "体重・体脂肪率の記録、グラフ、ひろば閲覧が使えます。",
  },
  {
    id: "ai_fasting",
    name: "本格ファスティングAIプラン",
    price: premiumPriceDisplay,
    description: "ファスティング計画、体調記録、AIチェック枠、ひろば投稿が使えます。",
  },
] as const;

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const datePart = String(value).slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

const defaultNextBillingDate = () => {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const previousDate = (value?: string | null) => {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const localBirthDateKey = "fastingBirthDate";
const localAppKeys = ["fastingAvatarPath", localBirthDateKey, DOWNGRADE_STORAGE_KEY];

const clearLocalAppState = () => {
  if (typeof window === "undefined") return;
  localAppKeys.forEach((key) => window.localStorage.removeItem(key));
};

const uniqueRows = (rows: unknown[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return true;
    const record = row as Record<string, unknown>;
    const key = String(record.id ?? `${record.user_id ?? ""}-${JSON.stringify(record)}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeProfileRows = (primary: ProfileRow | null, fallback: ProfileRow | null) => {
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

export default function SettingsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [source, setSource] = useState<ProfileSource>("old");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [pendingPlanAction, setPendingPlanAction] = useState<PlanAction>(null);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);
  const savedForm = useRef("");
  const [form, setForm] = useState({
    nickname: "",
    height: "",
    gender: "" as Gender | "",
    birthDate: "",
    age: "",
    goalWeight: "",
    startWeight: "",
    avatarPath: "/avatar_01.png",
    notificationsEnabled: true,
  });

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const [
      { data: newProfile, error: newProfileError },
      { data: oldProfile, error: oldProfileError },
      { data: securityRows, error: securityError },
      { error: feedbackStatusError },
      { data: latestNewRecords },
      { data: latestOldRecords },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.rpc("get_app_security_status"),
      supabase.from("app_feedback").select("id").limit(1),
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

    if (securityError) {
      setSecurityStatus({
        configured: false,
        accountDeletionReady: false,
        feedbackReady: !feedbackStatusError,
      });
    } else {
      const securityRow = Array.isArray(securityRows) ? securityRows[0] : securityRows;
      setSecurityStatus({
        configured: Boolean(securityRow?.configured),
        accountDeletionReady: Boolean(securityRow?.account_deletion_ready),
        feedbackReady: !feedbackStatusError,
      });
    }

    if (newProfileError && oldProfileError) {
      setLoadError(
        getUserFacingError(
          newProfileError,
          "設定情報を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    const row = mergeProfileRows(newProfile, oldProfile);
    if (!row) {
      router.push("/profile/setup");
      return;
    }
    const latestRecordedWeight =
      toNumber(latestNewRecords?.[0]?.weight_kg) ??
      toNumber(latestOldRecords?.[0]?.weight);
    if (
      toNumber(row.current_weight_kg ?? row.current_weight) === null &&
      latestRecordedWeight !== null
    ) {
      row.current_weight_kg = latestRecordedWeight;
    }
    if (row) {
      row.cancel_at_period_end = hasPendingDowngrade(
        {
          cancel_at_period_end:
            newProfile?.cancel_at_period_end || oldProfile?.cancel_at_period_end,
          subscription_cancel_at_period_end:
            newProfile?.subscription_cancel_at_period_end ||
            oldProfile?.subscription_cancel_at_period_end,
        },
        readPendingDowngrade()
      );
      row.subscription_cancel_at_period_end = row.cancel_at_period_end;
    }
    setEmail(user.email ?? "");
    setProfile(row);
    setSource(newProfile ? "new" : "old");

    if (row?.is_admin) {
      const { count } = await supabase
        .from("app_feedback")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      setNewFeedbackCount(count ?? 0);
    } else {
      setNewFeedbackCount(0);
    }

    const savedAvatar =
      row?.avatar_path ??
      row?.avatar_url ??
      row?.avatar ??
      avatarPathFromSeed(row?.avatar_seed) ??
      (typeof window !== "undefined" ? window.localStorage.getItem("fastingAvatarPath") : null) ??
      "/avatar_01.png";

    const savedBirthDate =
      typeof window !== "undefined" ? window.localStorage.getItem(localBirthDateKey) : null;
    const birthDate = row?.birth_date || savedBirthDate || "";
    const age = birthDate ? calculateAge(birthDate) : (row?.age ?? "").toString();

    const nextForm = {
      nickname: row?.nickname ?? "",
      height: (row?.height_cm ?? row?.height ?? "").toString(),
      gender: (row?.gender as Gender) ?? "",
      birthDate,
      age,
      goalWeight: (row?.goal_weight_kg ?? row?.goal_weight ?? "").toString(),
      startWeight: (
        row?.start_weight_kg ??
        row?.start_weight ??
        row?.current_weight_kg ??
        row?.current_weight ??
        latestRecordedWeight ??
        ""
      ).toString(),
      avatarPath: savedAvatar,
      notificationsEnabled: row?.notifications_enabled ?? true,
    };
    setForm(nextForm);
    savedForm.current = JSON.stringify(nextForm);
    setLoading(false);
  };

  const paid =
    profile?.plan_type === "ai_fasting" ||
    profile?.plan === "honkaku" ||
    profile?.plan === "light";

  const currentWeight =
    getProfileCurrentWeight(profile) ?? toNumber(form.startWeight);
  const targetWeight = toNumber(form.goalWeight);
  const height = toNumber(form.height);
  const displayAge = form.birthDate ? calculateAge(form.birthDate) : form.age;
  const currentBmi = useMemo(() => calcBmi(currentWeight, height), [currentWeight, height]);
  const targetBmi = useMemo(() => calcBmi(targetWeight, height), [targetWeight, height]);
  const minimumGoalWeight = height ? getMinimumWeightForBmi(height) : null;
  const fastingEligibility = getFastingEligibility({
    bmi: currentBmi,
    age: displayAge ? Number(displayAge) : null,
    birthDate: form.birthDate,
  });

  const nextBillingRaw =
    getSubscriptionPeriodEnd(profile) ?? (paid ? defaultNextBillingDate() : null);
  const nextBillingDate = formatDate(nextBillingRaw);
  const cancelDeadline = formatDate(previousDate(nextBillingRaw));
  const cancelAtPeriodEnd = hasPendingDowngrade(profile);
  const trialReadinessItems = [
    { label: "管理者アカウント", ready: Boolean(profile?.is_admin) },
    { label: "データ保護", ready: Boolean(securityStatus?.configured) },
    { label: "完全退会", ready: Boolean(securityStatus?.accountDeletionReady) },
    { label: "ご意見受付", ready: Boolean(securityStatus?.feedbackReady) },
  ];
  const trialReadinessCount = trialReadinessItems.filter((item) => item.ready).length;

  const saveProfile = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !profile) return;

    setSaving(true);
    setMessage("");

    const validationError = validateProfileFields({
      birthDate: form.birthDate,
      height: form.height,
      goalWeight: form.goalWeight,
      startWeight: form.startWeight,
    });
    if (validationError) {
      setSaving(false);
      setMessage(validationError);
      return;
    }

    const age = form.birthDate ? calculateAge(form.birthDate) : form.age;
    const startWeight = form.startWeight ? Number(form.startWeight) : null;
    const shouldSaveCurrentWeight = startWeight !== null;
    if (typeof window !== "undefined") {
      if (form.birthDate) {
        window.localStorage.setItem(localBirthDateKey, form.birthDate);
      } else {
        window.localStorage.removeItem(localBirthDateKey);
      }
    }
    const previousForm = savedForm.current
      ? (JSON.parse(savedForm.current) as typeof form)
      : null;
    const changed = <K extends keyof typeof form>(key: K) =>
      !previousForm || previousForm[key] !== form[key];
    const shouldUpdateWeightRecord =
      shouldSaveCurrentWeight && changed("startWeight");

    const oldUpdate: Record<string, unknown> = {};
    const newUpdate: Record<string, unknown> = {};

    if (changed("nickname")) {
      oldUpdate.nickname = form.nickname || null;
      newUpdate.nickname = form.nickname || null;
    }
    if (changed("gender")) {
      oldUpdate.gender = form.gender || null;
      newUpdate.gender = form.gender || null;
    }
    if (changed("birthDate")) {
      oldUpdate.birth_date = form.birthDate || null;
      newUpdate.birth_date = form.birthDate || null;
      oldUpdate.age = age ? Number(age) : null;
      newUpdate.age = age ? Number(age) : null;
    }
    if (changed("height")) {
      oldUpdate.height = form.height ? Number(form.height) : null;
      newUpdate.height_cm = form.height ? Number(form.height) : null;
    }
    if (changed("goalWeight")) {
      oldUpdate.goal_weight = form.goalWeight ? Number(form.goalWeight) : null;
      newUpdate.goal_weight_kg = form.goalWeight ? Number(form.goalWeight) : null;
    }
    if (changed("startWeight")) {
      oldUpdate.current_weight = startWeight;
      newUpdate.start_weight_kg = startWeight;
      newUpdate.current_weight_kg = startWeight;
    }
    if (changed("avatarPath")) {
      oldUpdate.avatar_seed = avatarSeedFromPath(form.avatarPath);
      newUpdate.avatar_path = form.avatarPath;
      newUpdate.avatar_seed = avatarSeedFromPath(form.avatarPath);
    }
    if (changed("notificationsEnabled")) {
      newUpdate.notifications_enabled = form.notificationsEnabled;
    }
    if (Object.keys(oldUpdate).length > 0) {
      oldUpdate.updated_at = new Date().toISOString();
    }

    const updateNewProfile = async () => {
      if (Object.keys(newUpdate).length === 0) return null;
      const result = await supabase
        .from("profiles")
        .update(newUpdate)
        .eq("id", user.id)
        .select("id")
        .maybeSingle();
      if (!result.error && result.data) return null;
      if (isMissingDatabaseObjectError(result.error)) {
        const fallbackUpdate = { ...oldUpdate };
        const fallback = await supabase
          .from("profiles")
          .update(fallbackUpdate)
          .eq("id", user.id)
          .select("id")
          .maybeSingle();
        if (!fallback.error && fallback.data) return null;
        return fallback.error ?? { message: "プロフィールの更新対象が見つかりませんでした" };
      }
      return result.error ?? { message: "プロフィールの更新対象が見つかりませんでした" };
    };

    const updateOldProfile = async () => {
      if (Object.keys(oldUpdate).length === 0) return null;
      const result = await supabase
        .from("profiles")
        .update(oldUpdate)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();
      if (!result.error && result.data) return null;
      if (result.error?.message.includes("birth_date")) {
        const { birth_date: _birthDate, ...fallbackUpdate } = oldUpdate;
        const fallback = await supabase
          .from("profiles")
          .update(fallbackUpdate)
          .eq("user_id", user.id)
          .select("id")
          .maybeSingle();
        if (!fallback.error && fallback.data) return null;
        return fallback.error ?? { message: "プロフィールの更新対象が見つかりませんでした" };
      }
      return result.error ?? { message: "プロフィールの更新対象が見つかりませんでした" };
    };

    let error =
      source === "new" ? await updateNewProfile() : await updateOldProfile();
    if (error) {
      const fallbackError =
        source === "new" ? await updateOldProfile() : await updateNewProfile();
      if (!fallbackError) error = null;
    }

    if (!error && shouldUpdateWeightRecord && startWeight !== null) {
      const recordResult = await saveWeightRecord({
        supabase,
        userId: user.id,
        recordedDate: getTodayString(),
        weight: startWeight,
        bodyFat: null,
        preserveExistingValues: true,
      });
      if (!recordResult.succeeded) {
        error = recordResult.newError ?? recordResult.oldError ?? {
          message: "開始体重を体重記録へ保存できませんでした",
        };
      }
    }

    if (!error && typeof window !== "undefined") {
      window.localStorage.setItem("fastingAvatarPath", form.avatarPath);
      if (form.birthDate) {
        window.localStorage.setItem(localBirthDateKey, form.birthDate);
      } else {
        window.localStorage.removeItem(localBirthDateKey);
      }
    }

    setSaving(false);
    if (error) {
      const databaseError = error as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      const detail = [
        databaseError.code,
        databaseError.message,
        databaseError.details,
        databaseError.hint,
      ]
        .filter(Boolean)
        .join(" / ");
      setMessage(
        `${getUserFacingError(error, "保存できませんでした。")}${
          detail ? ` エラー詳細: ${detail}` : ""
        }`
      );
      return;
    }

    savedForm.current = JSON.stringify(form);
    setMessage("設定を保存しました。");
    loadProfile();
  };

  const updatePlan = async (target: "free" | "ai_fasting") => {
    if (target === "ai_fasting" && !fastingEligibility.eligible) {
      setMessage(fastingEligibility.reason);
      setPendingPlanAction(null);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    setSaving(true);
    setMessage("");

    const restoringDowngrade = target === "ai_fasting" && paid && cancelAtPeriodEnd;
    const updates =
      target === "free"
        ? [
            { subscription_cancel_at_period_end: true },
            { cancel_at_period_end: true },
          ]
        : restoringDowngrade
          ? [
              { subscription_cancel_at_period_end: false },
              { cancel_at_period_end: false },
            ]
          : [
              {
                plan_type: "ai_fasting",
                ai_checks_remaining: 93,
                ai_checks_used_month: 0,
                subscription_cancel_at_period_end: false,
              },
              { plan: "honkaku", cancel_at_period_end: false },
              { plan_type: "ai_fasting" },
              { plan: "honkaku" },
            ];

    const filters = source === "new"
      ? [["id", user.id], ["user_id", user.id]]
      : [["user_id", user.id], ["id", user.id]];
    let error: any = null;
    let updated = false;

    for (const update of updates) {
      for (const [column, value] of filters) {
        const result = await supabase.from("profiles").update(update).eq(column, value).select("*");
        if (!result.error && (result.data?.length ?? 0) > 0) {
          updated = true;
          error = null;
        } else if (result.error) {
          error = result.error;
        }
      }
      if (updated) break;
    }

    if ((target === "free" || restoringDowngrade) && typeof window !== "undefined") {
      savePendingDowngrade(target === "free");
      setProfile((current) =>
        current
          ? {
              ...current,
              cancel_at_period_end: target === "free",
              subscription_cancel_at_period_end: target === "free",
            }
          : current
      );
      updated = true;
      error = null;
    }

    if (!updated) {
      error = error ?? { message: "予約状態を保存できませんでした" };
    }

    setSaving(false);
    setMessage(
      error
        ? getUserFacingError(
            error,
            "プランを更新できませんでした。時間をおいてもう一度お試しください。"
          )
        : target === "free"
          ? BILLING_ENABLED
            ? "ダウングレードを受け付けました。次回決済日までは有料機能を使えます。"
            : "無料プランへの変更予約を受け付けました。変更予定日までは本格プランを試せます。"
          : restoringDowngrade
            ? BILLING_ENABLED
              ? "ダウングレード予約を取り消しました。現在の有料プランを継続します。"
              : "無料プランへの変更予約を取り消しました。試用版の本格プランを継続します。"
            : BILLING_ENABLED
              ? "プランを更新しました"
              : "試用版の本格プランを有効にしました。料金は請求されません。"
    );
    if (!error) {
      setPendingPlanAction(null);
      if (target !== "free" && !restoringDowngrade) loadProfile();
    }
  };

  const exportData = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    setExporting(true);
    setMessage("");

    const tables = [
      ["profiles", "id"],
      ["profiles", "user_id"],
      ["daily_records", "user_id"],
      ["weight_records", "user_id"],
      ["daily_conditions", "user_id"],
      ["fasting_plans", "user_id"],
      ["fasting_records", "user_id"],
      ["fasting_logs", "user_id"],
      ["diagnosis_results", "user_id"],
      ["meal_checks", "user_id"],
      ["community_posts", "user_id"],
      ["community_post_likes", "user_id"],
      ["community_post_reports", "user_id"],
      ["status_posts", "user_id"],
      ["app_feedback", "user_id"],
    ] as const;

    const exported: Record<string, unknown> = {
      format_version: 2,
      app: "ファスティング倶楽部",
      exported_at: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        legal_consent: {
          terms_accepted_at: user.user_metadata?.terms_accepted_at ?? null,
          terms_version: user.user_metadata?.terms_version ?? null,
          privacy_accepted_at: user.user_metadata?.privacy_accepted_at ?? null,
          privacy_version: user.user_metadata?.privacy_version ?? null,
        },
      },
      tables: {},
      local: {
        avatar_path: typeof window !== "undefined" ? window.localStorage.getItem("fastingAvatarPath") : null,
        birth_date: typeof window !== "undefined" ? window.localStorage.getItem(localBirthDateKey) : null,
      },
      skipped_tables: [],
    };

    try {
      for (const [table, key] of tables) {
        const { data, error } = await supabase.from(table).select("*").eq(key, user.id);
        if (!error) {
          const current = (exported.tables as Record<string, unknown[]>)[table] ?? [];
          (exported.tables as Record<string, unknown[]>)[table] = uniqueRows([...current, ...(data ?? [])]);
          exported.skipped_tables = (exported.skipped_tables as string[]).filter(
            (skippedTable) => skippedTable !== table
          );
          continue;
        }

        const message = error.message.toLowerCase();
        const isMissingColumn =
          error.code === "PGRST204" ||
          (message.includes("column") &&
            (message.includes("does not exist") || message.includes("schema cache")));

        if (isMissingDatabaseObjectError(error) || isMissingColumn) {
          const skipped = exported.skipped_tables as string[];
          if (!skipped.includes(table)) skipped.push(table);
          continue;
        }

        throw error;
      }

      exported.partial = (exported.skipped_tables as string[]).length > 0;

      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fasting-diet-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);

      const skippedCount = (exported.skipped_tables as string[]).length;
      setHasExported(true);
      setMessage(
        skippedCount > 0
          ? `データをエクスポートしました。一部の未使用テーブルはスキップしました（${skippedCount}件）。`
          : "データをエクスポートしました"
      );
    } catch (error) {
      setHasExported(false);
      setMessage(
        getUserFacingError(
          error as { code?: string; message?: string },
          "データのエクスポートに失敗しました。時間をおいてもう一度お試しください。"
        )
      );
    } finally {
      setExporting(false);
    }
  };

  const deleteAccountData = async () => {
    if (deleteConfirm !== "削除する") {
      setMessage("確認欄に「削除する」と入力してください");
      return;
    }
    if (!hasExported) {
      setMessage("削除前にデータをエクスポートしてください。バックアップ後にもう一度削除できます。");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("delete_current_user_account");

    if (error) {
      setSaving(false);
      setMessage(
        error.message.includes("delete_current_user_account")
          ? "完全退会の設定がまだ完了していません。管理者へお問い合わせください。"
          : "アカウントの削除に失敗しました。時間をおいてもう一度お試しください。"
      );
      return;
    }

    clearLocalAppState();
    await supabase.auth.signOut();
    router.push("/auth/login?deleted=1");
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <h1 className="text-3xl font-bold tracking-normal">設定</h1>
          <p className="mt-2 text-base text-stone-400">プロフィールとプラン管理</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          {message && (
            <p
              className={`rounded-xl px-3 py-2 text-sm ${
                message.includes("失敗") ||
                message.includes("入力") ||
                message.includes("確認") ||
                message.includes("してください")
                  ? "bg-red-50 text-red-700"
                  : "bg-teal-50 text-teal-700"
              }`}
            >
              {message}
            </p>
          )}

          {loading ? (
            <SettingsStateCard title="読み込み中..." text="プロフィールとプラン情報を確認しています。" />
          ) : loadError ? (
            <SettingsStateCard title="読み込みに失敗しました" text={loadError}>
              <button
                type="button"
                onClick={loadProfile}
                className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white"
              >
                再読み込み
              </button>
            </SettingsStateCard>
          ) : (
            <>

          <section className="rounded-[22px] bg-[#5d9997] p-5 text-white shadow-sm">
            <p className="text-sm font-bold text-white/70">現在のプラン</p>
            <h2 className="mt-2 text-2xl font-bold">{planLabel(paid)}</h2>
            <p className="mt-2 text-sm font-bold text-white/70">
              {paid ? (BILLING_ENABLED ? premiumPriceDisplay : "試用版（請求なし）") : "無料"}
            </p>
          </section>

          <section id="profile-settings" className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold">プロフィール</h2>
            <p className="mt-1 text-sm text-stone-400">ホームやBMI計算に使う情報です</p>

            <div className="mt-4 space-y-4">
              <div>
                <p className={labelClass}>アイコン</p>
                <div className="flex items-center gap-4 rounded-2xl bg-stone-50 p-4">
                  <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white bg-[#f2eadf] shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.avatarPath} alt="選択中のアイコン" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700">ホームに表示されます</p>
                    <p className="mt-1 text-xs leading-5 text-stone-400">前のアプリで使っていた人物アイコンです。</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-3">
                  {AVATARS.map((avatar) => {
                    const selected = form.avatarPath === avatar.path;
                    return (
                      <button
                        key={avatar.seed}
                        type="button"
                        onClick={() => setForm({ ...form, avatarPath: avatar.path })}
                        className={`grid aspect-square place-items-center overflow-hidden rounded-full border-4 bg-[#f2eadf] transition ${
                          selected ? "border-[#5d9997] ring-2 ring-teal-100" : "border-white"
                        }`}
                        aria-label={`アイコン${avatar.seed}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={avatar.path} alt="" className="h-full w-full object-cover" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className={labelClass}>ニックネーム</span>
                <input className={inputClass} value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder="例：さくら" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>身長 cm</span>
                  <input className={inputClass} value={form.height} onChange={(event) => setForm({ ...form, height: event.target.value })} type="number" step="0.1" placeholder="160" />
                </label>
                <label className="block">
                  <span className={labelClass}>生年月日</span>
                  <input
                    className={inputClass}
                    value={form.birthDate}
                    onChange={(event) => {
                      const birthDate = event.target.value;
                      if (typeof window !== "undefined") {
                        if (birthDate) {
                          window.localStorage.setItem(localBirthDateKey, birthDate);
                        } else {
                          window.localStorage.removeItem(localBirthDateKey);
                        }
                      }
                      setForm({ ...form, birthDate, age: calculateAge(birthDate) });
                    }}
                    type="date"
                  />
                </label>
              </div>

              <div className="rounded-2xl bg-stone-50 px-4 py-3">
                <p className="text-sm font-bold text-stone-500">年齢</p>
                <p className="mt-1 text-2xl font-light text-[#4d8b8a]">{displayAge ? `${displayAge}歳` : "--"}</p>
              </div>

              <div>
                <p className={labelClass}>性別</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["female", "女性"],
                    ["male", "男性"],
                    ["other", "その他"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm({ ...form, gender: value as Gender })}
                      className={`rounded-xl border px-3 py-3 text-sm font-bold ${
                        form.gender === value ? "border-[#5d9997] bg-teal-50 text-[#4d8b8a]" : "border-stone-200 text-stone-500"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>目標体重 kg</span>
                  <input className={inputClass} value={form.goalWeight} onChange={(event) => setForm({ ...form, goalWeight: event.target.value })} type="number" step="0.1" placeholder="48" />
                </label>
                <label className="block">
                  <span className={labelClass}>開始体重 kg</span>
                  <input className={inputClass} value={form.startWeight} onChange={(event) => setForm({ ...form, startWeight: event.target.value })} type="number" step="0.1" placeholder="56.8" />
                  <span className="mt-2 block text-xs leading-5 text-stone-400">
                    現在体重が未登録の場合は、BMI判定の初期体重として使用します。
                  </span>
                </label>
              </div>
              {minimumGoalWeight !== null && (
                <p className="rounded-xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-500">
                  BMI 18.5を下回らない目標体重：
                  <span className="font-bold text-[#4d8b8a]">{minimumGoalWeight.toFixed(1)}kg以上</span>
                </p>
              )}

              {source === "new" && (
                <label className="flex items-center gap-2 rounded-xl bg-stone-50 px-4 py-3 text-sm font-bold text-slate-600">
                  <input type="checkbox" checked={form.notificationsEnabled} onChange={(event) => setForm({ ...form, notificationsEnabled: event.target.checked })} />
                  通知を受け取る
                </label>
              )}

              <button onClick={saveProfile} disabled={saving} className="w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white disabled:opacity-60">
                {saving ? "保存中..." : "保存する"}
              </button>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <BmiCard title="現在BMI" value={currentBmi} />
            <BmiCard title="目標BMI" value={targetBmi} />
          </section>

          {!BILLING_ENABLED ? (
            <section id="plan-management" className="scroll-mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-5">
              <p className="text-sm font-bold text-teal-700">モニター期間中</p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">すべての試用機能を利用できます</h2>
              <p className="mt-2 text-sm leading-7 text-teal-900">
                プラン変更は不要です。ファスティング計画、体調記録、回復食ガイド、AI先行版、レポートを料金なしでお試しいただけます。
              </p>
              <button
                type="button"
                onClick={() => router.push("/fasting")}
                className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white"
              >
                ファスティング計画へ
              </button>
            </section>
          ) : (
          <section id="plan-management" className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold">プラン管理</h2>
            {!BILLING_ENABLED && (
              <div className="mt-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm leading-6 text-teal-800">
                <p className="font-bold">試用版のため、現在は請求されません</p>
                <p>表示価格は正式版の予定価格です。決済開始時は、申込み前に改めて確認画面を表示します。</p>
              </div>
            )}
            <div className="mt-3 rounded-2xl bg-stone-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-stone-400">選択中のプラン</p>
                {cancelAtPeriodEnd && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                    ダウングレード予約中
                  </span>
                )}
              </div>
              <p className="mt-1 text-lg font-bold text-slate-800">{planLabel(paid)}</p>
              <p className="mt-1 text-sm font-bold text-[#5d9997]">{paid ? "月額1,980円" : "無料"}</p>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-sm font-bold text-slate-600">選べるプラン</p>
              {PLAN_OPTIONS.map((plan) => {
                const selected = paid ? plan.id === "ai_fasting" : plan.id === "free";
                return (
                  <div
                    key={plan.id}
                    className={`rounded-2xl border px-4 py-3 ${
                      selected ? "border-[#5d9997] bg-teal-50" : "border-stone-100 bg-white"
                    }`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                      {selected && !cancelAtPeriodEnd && (
                        <span className="shrink-0 rounded-full bg-[#5d9997] px-3 py-1 text-xs font-bold text-white">
                          現在
                        </span>
                      )}
                      {paid && cancelAtPeriodEnd && plan.id === "ai_fasting" && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                          現在・終了予定
                        </span>
                      )}
                      {paid && cancelAtPeriodEnd && plan.id === "free" && (
                        <span className="shrink-0 rounded-full bg-stone-200 px-3 py-1 text-xs font-bold text-stone-600">
                          次回から
                        </span>
                      )}
                      </div>
                      <p className="mt-2 text-base font-bold text-slate-800">{plan.name}</p>
                      <p className="mt-1 text-sm font-bold text-[#5d9997]">{plan.price}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-500">{plan.description}</p>
                  </div>
                );
              })}
            </div>

            {paid && (
              <div className={`mt-3 rounded-2xl px-4 py-3 text-sm leading-6 ${
                cancelAtPeriodEnd ? "border border-amber-200 bg-amber-50 text-amber-900" : "bg-amber-50 text-amber-800"
              }`}>
                <p className="font-bold">
                  {cancelAtPeriodEnd
                    ? "無料プランへの変更予約中"
                    : BILLING_ENABLED
                      ? `次回決済予定：${nextBillingDate ?? "決済連携後に表示"}`
                      : "試用版の本格プランを利用中"}
                </p>
                <p className="mt-1">
                  {cancelAtPeriodEnd
                    ? `${nextBillingDate ?? "変更予定日"}までは本格プランの機能を使えます。その後は無料の体重管理プランへ変わります。`
                    : BILLING_ENABLED
                      ? `${cancelDeadline ?? "次回決済日の前日"}までにダウングレードすれば、次回分の料金は発生しません。`
                      : "料金は発生しません。無料プランへの変更もいつでも予約できます。"}
                </p>
              </div>
            )}
            <p className="mt-3 text-sm leading-6 text-stone-500">
              {paid
                ? cancelAtPeriodEnd
                  ? "予約はいつでも取り消せます。"
                  : BILLING_ENABLED
                    ? "ダウングレード先は無料の体重管理プランです。予約後も次回決済予定日までは有料機能を使えます。"
                    : "変更先は無料の体重管理プランです。試用版のため、どちらのプランを選んでも請求はありません。"
                : "無料プランでは体重記録とグラフを使えます。"}
            </p>

            {!fastingEligibility.eligible && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                <p className="font-bold">
                  {paid ? "本格プランの安全条件を満たしていません" : "本格プランは現在選択できません"}
                </p>
                <p className="mt-1">{fastingEligibility.reason}</p>
                <p className="mt-1 text-xs text-amber-700">
                  {paid
                    ? "ファスティング機能は停止されています。無料プランへの変更をご検討ください。"
                    : "BMI 18.5以上になった場合は、最新の体重を記録すると再判定されます。"}
                </p>
              </div>
            )}

            {paid ? (
              <button
                onClick={() => setPendingPlanAction(cancelAtPeriodEnd ? "resume" : "downgrade")}
                disabled={saving || (cancelAtPeriodEnd && !fastingEligibility.eligible)}
                className={`mt-4 w-full rounded-xl py-3 text-base font-bold disabled:opacity-60 ${
                  cancelAtPeriodEnd
                    ? "bg-[#5d9997] text-white"
                    : "border border-stone-200 text-stone-600"
                }`}
              >
                {saving
                  ? "更新中..."
                  : cancelAtPeriodEnd
                    ? fastingEligibility.eligible
                      ? "ダウングレード予約を取り消す"
                      : "安全条件により予約取消不可"
                    : BILLING_ENABLED
                      ? "無料プランへダウングレード"
                      : "無料プランへ変更"}
              </button>
            ) : (
              <button onClick={() => setPendingPlanAction("upgrade")} disabled={saving || !fastingEligibility.eligible} className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-base font-bold text-white disabled:opacity-40">
                本格ファスティングAIプランに切り替える
              </button>
            )}

            {pendingPlanAction && (
              <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm font-bold text-slate-800">
                  {pendingPlanAction === "upgrade"
                    ? "本格ファスティングAIプランへ変更しますか？"
                    : pendingPlanAction === "downgrade"
                      ? "無料プランへの変更を予約しますか？"
                      : "ダウングレード予約を取り消しますか？"}
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  {pendingPlanAction === "upgrade"
                    ? BILLING_ENABLED
                      ? "月額1,980円のプランです。ファスティング計画、詳細体調記録、回復食ガイド、月次レポートが使えます。"
                      : "試用版のため料金は請求されません。ファスティング計画、詳細体調記録、回復食ガイド、月次レポートを試せます。"
                    : pendingPlanAction === "downgrade"
                      ? `${nextBillingDate ?? "現在の有効期限"}までは有料機能を使え、その後は無料の体重管理プランへ変更されます。`
                      : "取り消すと次回決済後も本格ファスティングAIプランを継続します。"}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingPlanAction(null)}
                    disabled={saving}
                    className="rounded-xl border border-stone-200 bg-white py-3 text-sm font-bold text-stone-500 disabled:opacity-60"
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updatePlan(pendingPlanAction === "downgrade" ? "free" : "ai_fasting")
                    }
                    disabled={saving}
                    className="rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {saving
                      ? "更新中..."
                      : pendingPlanAction === "upgrade"
                        ? "変更を確定"
                        : pendingPlanAction === "downgrade"
                          ? "予約を確定"
                          : "取り消しを確定"}
                  </button>
                </div>
              </div>
            )}
          </section>
          )}

          {profile?.is_admin && (
            <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <h2 className="text-lg font-bold">管理者メニュー</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">投稿の通報と、試用者から届いたご意見を確認できます。</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => router.push("/admin/community")} className="rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white">
                  投稿確認
                </button>
                <button onClick={() => router.push("/admin/feedback")} className="relative rounded-xl border border-teal-200 py-3 text-sm font-bold text-teal-700">
                  ご意見確認
                  {newFeedbackCount > 0 && (
                    <span className="absolute -right-2 -top-2 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                      {newFeedbackCount > 99 ? "99+" : newFeedbackCount}
                    </span>
                  )}
                </button>
              </div>

              <div className="mt-5 rounded-2xl bg-stone-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-700">試用準備状況</p>
                    <p className="mt-1 text-xs text-stone-400">モニター受け入れに必要なアプリ設定</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      trialReadinessCount === trialReadinessItems.length
                        ? "bg-teal-100 text-teal-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {trialReadinessCount}/{trialReadinessItems.length}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {trialReadinessItems.map((item) => (
                    <div
                      key={item.label}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
                        item.ready ? "bg-white text-teal-700" : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      <span aria-hidden="true">{item.ready ? "✓" : "!"}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/monitor")}
                  className="mt-4 w-full rounded-xl border border-teal-200 bg-white py-3 text-sm font-bold text-teal-700"
                >
                  モニター案内を確認
                </button>
              </div>
            </section>
          )}

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold">試用版へのご意見</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              不具合、使いにくい点、追加してほしい機能を運営へ送れます。
            </p>
            <button
              onClick={() => router.push("/feedback")}
              className="mt-4 w-full rounded-xl border border-teal-200 py-3 text-base font-bold text-teal-700"
            >
              ご意見・不具合を送る
            </button>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold">データ保護</h2>
            <div
              className={`mt-3 rounded-2xl px-4 py-3 text-sm leading-6 ${
                securityStatus?.configured
                  ? "bg-teal-50 text-teal-700"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              <p className="font-bold">
                {securityStatus?.configured
                  ? "データ保護設定済み"
                  : "セキュリティ設定の確認が必要です"}
              </p>
              <p className="mt-1">
                {securityStatus?.configured
                  ? "健康記録はログイン中の本人だけが読み書きできる設定です。"
                  : "Supabaseで最新の security_hardening.sql を実行すると設定が完了します。"}
              </p>
            </div>
            {securityStatus?.configured && (
              <div className="mt-3 space-y-1 text-xs leading-5 text-stone-400">
                <p>
                  完全退会機能：
                  {securityStatus.accountDeletionReady ? "設定済み" : "追加SQLの適用待ち"}
                </p>
                <p>
                  試用報告受付：
                  {securityStatus.feedbackReady ? "設定済み" : "app_feedback.sql の適用待ち"}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold">データ管理</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              サービス撤退時や機種変更に備えて、記録データをJSON形式で保存できます。
            </p>
            <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
              <p className="font-bold text-slate-700">エクスポート内容</p>
              <p className="mt-1">プロフィール、体重記録、体調記録、ファスティング計画、ひろば投稿、いいね、通報履歴を保存します。</p>
              <p className="mt-1 text-xs text-stone-400">
                未使用の旧データ項目が存在しない場合は、その項目だけをスキップします。
              </p>
            </div>
            <button onClick={exportData} disabled={exporting} className="mt-4 w-full rounded-xl border border-teal-200 py-3 text-base font-bold text-teal-700 disabled:opacity-60">
              {exporting ? "作成中..." : "データをエクスポート"}
            </button>
            {hasExported && <p className="mt-2 text-xs font-bold text-teal-700">バックアップ作成済みです。</p>}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold">アカウント</h2>
            <p className="mt-3 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-600">{email || "メールアドレス未取得"}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href="/terms" className="rounded-xl border border-stone-200 py-3 text-center text-sm font-bold text-stone-600">
                利用規約
              </a>
              <a href="/privacy" className="rounded-xl border border-stone-200 py-3 text-center text-sm font-bold text-stone-600">
                プライバシー
              </a>
            </div>
            <button onClick={logout} className="mt-3 w-full rounded-xl border border-stone-200 py-3 text-base font-bold text-stone-600">
              ログアウト
            </button>
          </section>

          <section className="rounded-2xl border border-red-100 bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold text-red-600">完全退会</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              ログイン情報、プロフィール、記録、投稿などを完全に削除します。この操作は取り消せません。
            </p>
            <div className={`mt-4 rounded-2xl px-4 py-3 text-sm leading-6 ${hasExported ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-700"}`}>
              {hasExported
                ? "バックアップ作成済みです。削除する場合は確認欄に入力してください。"
                : "先に「データをエクスポート」してバックアップを作成してください。"}
            </div>
            <input
              className="mt-4 w-full rounded-xl border border-red-100 px-4 py-3 text-sm outline-none focus:border-red-300"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder="削除する と入力"
            />
            <button onClick={deleteAccountData} disabled={saving || !hasExported} className="mt-3 w-full rounded-xl bg-red-500 py-3 text-base font-bold text-white disabled:opacity-60">
              {saving ? "削除中..." : "アカウントを完全に削除する"}
            </button>
          </section>
            </>
          )}
        </main>
      </div>

      <Navigation active="settings" />
    </div>
  );
}

function SettingsStateCard({
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
      <p className="text-base font-bold text-slate-800">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-500">{text}</p>
      {children}
    </section>
  );
}

function BmiCard({ title, value }: { title: string; value: number | null }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <p className="text-sm font-bold text-stone-400">{title}</p>
      <p className="mt-2 text-3xl font-light text-[#4d8b8a]">{value ? value.toFixed(1) : "--"}</p>
      <p className="text-sm text-stone-400">{bmiLabel(value)}</p>
    </div>
  );
}
