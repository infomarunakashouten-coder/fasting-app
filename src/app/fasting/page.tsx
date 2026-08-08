"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { hasPremiumAccess } from "@/lib/billing";
import { getFastingEligibility } from "@/lib/fasting-eligibility";
import { getLatestVisibleFastingPlan } from "@/lib/fasting-plan";
import { getProfileCurrentWeight } from "@/lib/profile-weight";
import { calcBMI, createClient, getTodayString } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

type ProfileRow = Record<string, any>;
type PlanRow = Record<string, any>;
type Tab = "plan" | "guide" | "record" | "ai";
type DurationOption = "3" | "5" | "7" | "custom";
type Notice = { type: "success" | "error" | "info"; text: string } | null;

const SAFETY_CONSENT_VERSION = "fasting-safety-v1-2026-06-12";
const SAFETY_NOTICE_TEXT =
  "妊娠・授乳中ではなく18歳以上であること、持病・服薬・摂食障害の既往がある場合は事前に医師などへ相談したこと、めまい・動悸・強いだるさなどが出た場合は中止し必要に応じて受診することを確認しました。このアプリは記録と情報整理を目的とし、医療上の診断や治療を行うものではありません。";

const inputClass =
  "w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5d9997] focus:ring-2 focus:ring-teal-100";

const noticeClass = {
  success: "bg-teal-50 text-teal-700 border-teal-100",
  error: "bg-red-50 text-red-700 border-red-100",
  info: "bg-stone-50 text-stone-600 border-stone-100",
};

const phases = {
  prep: { label: "準備期", color: "bg-sky-50 text-sky-700", description: "食事を軽く整えて、本番に向ける期間です。" },
  main: { label: "本番期", color: "bg-teal-50 text-teal-700", description: "決めた飲み物と水分を中心に過ごす期間です。" },
  recovery: { label: "回復期", color: "bg-amber-50 text-amber-700", description: "胃腸にやさしい食事から戻していく期間です。" },
  before: { label: "開始前", color: "bg-stone-100 text-stone-600", description: "開始日まで準備を整えましょう。" },
  after: { label: "終了", color: "bg-stone-100 text-stone-600", description: "おつかれさまでした。記録を振り返りましょう。" },
};

const localDate = (date: string) => new Date(`${date}T00:00:00`);

const toDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date: string, days: number) => {
  const next = localDate(date);
  next.setDate(next.getDate() + days);
  return toDateString(next);
};

const recordMealTimes = (record: PlanRow | null | undefined): string[] => {
  if (!record) return [];
  if (Array.isArray(record.meal_times)) {
    return record.meal_times.map(String).map((time) => time.slice(0, 5)).filter(Boolean).sort();
  }
  return record.eating_time ? [String(record.eating_time).slice(0, 5)] : [];
};

const mealDateTime = (date: string, time: string) => new Date(`${date}T${time}:00`);

const formatDate = (date: string | null | undefined) => {
  if (!date) return "未設定";
  return localDate(date).toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
};

const getPlanDays = (plan: PlanRow | null) => {
  if (!plan) return { prep: 0, main: 0, recovery: 0, total: 0 };

  const prep = Number(plan.prep_days ?? 0);
  const main = Number(plan.main_days ?? 0);
  const recovery = Number(plan.recovery_days ?? 0);
  const customTotal = prep + main + recovery;
  if (prep > 0 && main > 0 && recovery > 0 && customTotal > 0) {
    return { prep, main, recovery, total: customTotal };
  }

  if (plan.duration_days) {
    const duration = Number(plan.duration_days);
    if (duration === 3) return { prep: 1, main: 1, recovery: 1, total: 3 };
    if (duration === 5) return { prep: 1, main: 2, recovery: 2, total: 5 };
    return { prep: 2, main: 2, recovery: 3, total: 7 };
  }

  return { prep: 1, main: 1, recovery: 1, total: 3 };
};

const getPhase = (plan: PlanRow | null, today: string) => {
  if (!plan?.start_date) return null;

  const days = getPlanDays(plan);
  const elapsed = Math.floor((localDate(today).getTime() - localDate(plan.start_date).getTime()) / 86400000);

  if (elapsed < 0) return { ...phases.before, day: 0, total: days.total, progress: 0 };
  if (elapsed >= days.total) return { ...phases.after, day: days.total, total: days.total, progress: 100 };
  if (elapsed < days.prep) return { ...phases.prep, day: elapsed + 1, total: days.total, progress: ((elapsed + 1) / days.total) * 100 };
  if (elapsed < days.prep + days.main) return { ...phases.main, day: elapsed + 1, total: days.total, progress: ((elapsed + 1) / days.total) * 100 };
  return { ...phases.recovery, day: elapsed + 1, total: days.total, progress: ((elapsed + 1) / days.total) * 100 };
};

const legacyPlanDays = (duration: number) =>
  duration === 3
    ? { prep_days: 1, main_days: 1, recovery_days: 1 }
    : duration === 5
      ? { prep_days: 1, main_days: 2, recovery_days: 2 }
      : { prep_days: 2, main_days: 2, recovery_days: 3 };

const normalizedPhaseDays = (prep: string, main: string, recovery: string) => ({
  prep_days: Math.max(Number(prep) || 1, 1),
  main_days: Math.max(Number(main) || 1, 1),
  recovery_days: Math.max(Number(recovery) || 1, 1),
});

const isMissingColumnError = (error: { message?: string } | null, column: string) =>
  Boolean(error?.message?.includes(`'${column}' column`) || error?.message?.includes(`column "${column}"`));

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

const getSchedule = (plan: PlanRow | null) => {
  if (!plan?.start_date) return [];
  const days = getPlanDays(plan);
  const items: Array<{ date: string; label: string; description: string; active: boolean }> = [];

  for (let index = 0; index < days.total; index += 1) {
    const date = addDays(plan.start_date, index);
    const label =
      index < days.prep
        ? "準備期"
        : index < days.prep + days.main
          ? "本番期"
          : "回復期";
    const description =
      label === "準備期"
        ? "脂っこいものや甘いものを控え、軽めの食事へ整えます。"
        : label === "本番期"
          ? `${plan.main_drink ?? "発酵ドリンク"}と水分を中心に、無理なく過ごします。`
          : "おかゆや具なし味噌汁など、胃腸にやさしい食事から戻します。";

    items.push({ date, label, description, active: date === getTodayString() });
  }

  return items;
};

const RECOVERY_GUIDE = [
  {
    title: "回復食 1食目",
    foods: "重湯、おかゆ、具なし味噌汁",
    note: "量は少なめにして、よく噛むよりもゆっくり飲む感覚で始めます。",
  },
  {
    title: "回復食 2食目",
    foods: "おかゆ、野菜スープ、豆腐",
    note: "油もの、肉、菓子、アルコールはまだ避けます。",
  },
  {
    title: "回復期の翌日",
    foods: "やわらかいごはん、蒸し野菜、味噌汁",
    note: "満腹まで食べず、いつもの7割くらいを目安にします。",
  },
];

const PREP_MEAL_MENUS = [
  {
    day: 1,
    title: "準備食 1日目",
    description: "温かく、やわらかく、薄味を意識し、腹七〜八分目に整えます。",
    meals: [
      {
        label: "朝",
        menu: "おかゆ、具だくさん味噌汁、豆腐、温野菜、白湯または麦茶",
      },
      {
        label: "昼",
        menu: "おかゆ、野菜たっぷり味噌汁、豆腐または納豆少量、やわらかい煮物",
      },
      {
        label: "夜",
        menu: "おかゆ、具だくさん味噌汁または野菜スープ、煮野菜、梅干し少量、白湯",
      },
    ],
  },
  {
    day: 2,
    title: "準備食 2日目",
    description: "1日目より水分を多めにしたおかゆで、夕食は少し物足りない程度にします。",
    meals: [
      {
        label: "朝",
        menu: "おかゆ、味噌汁、豆腐、すりおろしりんご少量",
      },
      {
        label: "昼",
        menu: "おかゆ、野菜スープ、温野菜、豆腐",
      },
      {
        label: "夜",
        menu: "ゆるめのおかゆ、具なしまたは具少なめ味噌汁、煮野菜少量、白湯",
      },
    ],
  },
];

const FASTING_SUPPORT_GUIDE = [
  {
    level: "少しお腹がすいた",
    action: "白湯、発酵ドリンク、具なし味噌汁で様子を見ます。",
    tone: "bg-teal-50 text-teal-800",
  },
  {
    level: "かなり空腹でつらい",
    action: "蒸したさつまいもをひと口〜50g程度、重湯、薄いおかゆなどを少量取ります。",
    tone: "bg-amber-50 text-amber-900",
  },
  {
    level: "めまい・冷や汗・震えがある",
    action: "本番を中止し、回復食へ切り替えます。",
    tone: "bg-rose-50 text-rose-800",
  },
  {
    level: "吐き気・動悸・立てないほどつらい",
    action: "中止し、必要に応じて医療機関へ相談してください。",
    tone: "bg-rose-100 text-rose-900",
  },
];

const getPhaseGuide = (phase: ReturnType<typeof getPhase>, mainDrink: string) => {
  if (!phase) {
    return {
      title: "計画前の整え方",
      description: "まずは開始日と期間を決めて、前日から食事を軽く整える準備をします。",
      items: ["夕食を少し軽めにする", "水分をこまめに取る", "睡眠時間を確保する"],
    };
  }

  if (phase.label === phases.before.label) {
    return {
      title: "開始前の準備",
      description: "開始日に向けて、胃腸に負担が少ない食事へ少しずつ寄せていきます。",
      items: ["油ものや甘いものを控える", "夕食を早めに済ませる", "無理な運動は避ける"],
    };
  }

  if (phase.label === phases.prep.label) {
    return {
      title: "準備期の過ごし方",
      description: "本番に入る前のならし期間です。食事量と刺激物を少し落としていきます。",
      items: ["腹八分目を意識する", "野菜・汁物を中心にする", "カフェインとアルコールを控える"],
    };
  }

  if (phase.label === phases.main.label) {
    return {
      title: "本番期の過ごし方",
      description: `${mainDrink}と水分を中心に、体調を見ながら静かに過ごします。`,
      items: ["水分を分けて取る", "強い空腹やめまいは記録する", "つらい日は中止も選択肢にする"],
    };
  }

  if (phase.label === phases.recovery.label) {
    return {
      title: "回復期の過ごし方",
      description: "ここで一気に戻さないことが大切です。少量から胃腸を慣らします。",
      items: ["重湯やおかゆから始める", "油もの・菓子・アルコールは避ける", "満腹まで食べない"],
    };
  }

  return {
    title: "終了後の振り返り",
    description: "体重だけでなく、空腹感・睡眠・むくみなどの変化も振り返ります。",
    items: ["体調記録を見返す", "回復食を急がず続ける", "次回は無理のない期間を選ぶ"],
  };
};

export default function FastingPage() {
  const router = useRouter();
  const supabase = createClient();
  const today = getTodayString();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [latestPlan, setLatestPlan] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("plan");
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [confirmResetPlan, setConfirmResetPlan] = useState(false);
  const [confirmReplacePlan, setConfirmReplacePlan] = useState(false);
  const [safetyChecks, setSafetyChecks] = useState({
    pregnancy: false,
    consultation: false,
    stopWhenUnwell: false,
  });
  const [conditionHistory, setConditionHistory] = useState<PlanRow[]>([]);
  const savedPlanForm = useRef("");
  const savedRecordForm = useRef("");

  const [planForm, setPlanForm] = useState({
    startDate: today,
    duration: "3" as DurationOption,
    prepDays: "1",
    mainDays: "1",
    recoveryDays: "1",
    mainDrink: "発酵ドリンク",
    memo: "",
  });

  const [recordForm, setRecordForm] = useState({
    water: "",
    hunger: "3",
    condition: "ふつう",
    sleep: "",
    bowelMovement: "なし",
    swelling: false,
    discomfort: "",
    meal: "",
    eatingTimes: [""],
    memo: "",
  });
  const hasUnsavedPlan =
    savedPlanForm.current !== "" && JSON.stringify(planForm) !== savedPlanForm.current;
  const hasUnsavedRecord =
    savedRecordForm.current !== "" && JSON.stringify(recordForm) !== savedRecordForm.current;
  useUnsavedChanges(!loading && !saving && (hasUnsavedPlan || hasUnsavedRecord));

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

    const [
      { data: newProfile, error: newProfileError },
      { data: oldProfile, error: oldProfileError },
      { data: plans, error: plansError },
      { data: condition, error: conditionError },
      { data: conditions, error: conditionsError },
      { data: latestNewRecords },
      { data: latestOldRecords },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("fasting_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("daily_conditions").select("*").eq("user_id", user.id).eq("recorded_date", today).maybeSingle(),
      supabase.from("daily_conditions").select("*").eq("user_id", user.id).order("recorded_date", { ascending: false }).limit(5),
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

    const profileError = newProfileError && oldProfileError ? newProfileError : null;
    const error = profileError ?? plansError ?? conditionError ?? conditionsError;
    if (error) {
      setLoadError(
        getUserFacingError(
          error,
          "ファスティング情報を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    const plan = getLatestVisibleFastingPlan(plans);
    const mergedProfile = mergeProfileRows(newProfile, oldProfile);
    const latestRecordedWeight = Number(
      latestNewRecords?.[0]?.weight_kg ?? latestOldRecords?.[0]?.weight
    );
    if (
      mergedProfile &&
      getProfileCurrentWeight(mergedProfile) === null &&
      Number.isFinite(latestRecordedWeight) &&
      latestRecordedWeight > 0
    ) {
      mergedProfile.current_weight_kg = latestRecordedWeight;
    }
    setProfile(mergedProfile);
    setLatestPlan(plan);
    setConditionHistory(conditions ?? []);

    if (plan?.start_date) {
      const days = getPlanDays(plan);
      const durationOption: DurationOption =
        days.total === 3 && days.prep === 1 && days.main === 1 && days.recovery === 1
          ? "3"
          : days.total === 5 && days.prep === 1 && days.main === 2 && days.recovery === 2
            ? "5"
            : days.total === 7 && days.prep === 2 && days.main === 2 && days.recovery === 3
              ? "7"
              : "custom";

      const nextPlanForm = {
        startDate: plan.start_date,
        duration: durationOption,
        prepDays: String(days.prep),
        mainDays: String(days.main),
        recoveryDays: String(days.recovery),
        mainDrink: plan.main_drink ?? "発酵ドリンク",
        memo: plan.memo ?? "",
      };
      setPlanForm(nextPlanForm);
      savedPlanForm.current = JSON.stringify(nextPlanForm);
    } else {
      savedPlanForm.current = JSON.stringify(planForm);
    }

    if (condition) {
      const nextRecordForm = {
        water: condition.water_ml ? (Number(condition.water_ml) / 1000).toString() : "",
        hunger: (condition.hunger_level ?? "3").toString(),
        condition: condition.condition ?? "ふつう",
        sleep: (condition.sleep_hours ?? "").toString(),
        bowelMovement: condition.bowel_movement ?? "なし",
        swelling: condition.swelling === "slight" || condition.swelling === "bad",
        discomfort: condition.discomfort ?? "",
        meal: condition.meal_log ?? "",
        eatingTimes: recordMealTimes(condition).length > 0 ? recordMealTimes(condition) : [""],
        memo: condition.memo ?? "",
      };
      setRecordForm(nextRecordForm);
      savedRecordForm.current = JSON.stringify(nextRecordForm);
    } else {
      savedRecordForm.current = JSON.stringify(recordForm);
    }
    setLoading(false);
  };

  const paid = hasPremiumAccess(profile?.plan_type, profile?.plan);
  const profileHeight = Number(profile?.height_cm ?? profile?.height);
  const profileWeight = getProfileCurrentWeight(profile);
  const profileBmi =
    Number.isFinite(profileHeight) &&
    profileHeight > 0 &&
    profileWeight !== null
      ? calcBMI(profileWeight, profileHeight)
      : null;
  const profileAge =
    profile?.age !== null && profile?.age !== undefined && Number.isFinite(Number(profile.age))
      ? Number(profile.age)
      : null;
  const fastingEligibility = getFastingEligibility({
    bmi: profileBmi,
    age: profileAge,
    birthDate: profile?.birth_date,
  });
  const phase = useMemo(() => getPhase(latestPlan, today), [latestPlan, today]);
  const days = getPlanDays(latestPlan);
  const schedule = useMemo(() => getSchedule(latestPlan), [latestPlan]);
  const isDuringFasting = Boolean(
    latestPlan &&
      phase &&
      phase.label !== phases.before.label &&
      phase.label !== phases.after.label
  );
  const conditionTitle = isDuringFasting ? "今日の体調記録" : "日々の体調メモ";
  const conditionDescription = isDuringFasting
    ? "ファスティング中の変化を残します"
    : "開始前や通常日の体調も残せます";
  const enteredMealTimes = recordForm.eatingTimes.filter(Boolean).sort();
  const previousMealRecord = conditionHistory.find(
    (record) => record.recorded_date < today && recordMealTimes(record).length > 0
  );
  const previousMealTimes = recordMealTimes(previousMealRecord);
  const latestIntervalHours = (() => {
    if (enteredMealTimes.length === 0) return null;
    const currentMeal = mealDateTime(today, enteredMealTimes[enteredMealTimes.length - 1]);
    if (enteredMealTimes.length >= 2) {
      const previousMeal = mealDateTime(today, enteredMealTimes[enteredMealTimes.length - 2]);
      return (currentMeal.getTime() - previousMeal.getTime()) / 3600000;
    }
    if (previousMealRecord && previousMealTimes.length > 0) {
      const previousMeal = mealDateTime(previousMealRecord.recorded_date, previousMealTimes[previousMealTimes.length - 1]);
      return (currentMeal.getTime() - previousMeal.getTime()) / 3600000;
    }
    return null;
  })();
  const nextMealGuide = enteredMealTimes.length > 0
    ? new Date(mealDateTime(today, enteredMealTimes[enteredMealTimes.length - 1]).getTime() + 16 * 3600000)
    : null;
  const previewDays =
    planForm.duration === "custom"
      ? normalizedPhaseDays(planForm.prepDays, planForm.mainDays, planForm.recoveryDays)
      : legacyPlanDays(Number(planForm.duration));
  const previewTotal = previewDays.prep_days + previewDays.main_days + previewDays.recovery_days;
  const previewEndDate = addDays(planForm.startDate, previewTotal - 1);
  const safetyConfirmed = Object.values(safetyChecks).every(Boolean);

  const savePlan = async () => {
    if (!safetyConfirmed) {
      setNotice({
        type: "error",
        text: "安全に関する確認事項を確認し、チェックを入れてください。",
      });
      return;
    }

    if (!planForm.startDate || Number.isNaN(localDate(planForm.startDate).getTime())) {
      setNotice({ type: "error", text: "開始日を確認してください。" });
      return;
    }

    if (planForm.duration === "custom") {
      const rawDays = [
        Number(planForm.prepDays),
        Number(planForm.mainDays),
        Number(planForm.recoveryDays),
      ];
      if (rawDays.some((value) => !Number.isInteger(value) || value < 1 || value > 30)) {
        setNotice({ type: "error", text: "各期間の日数は1日から30日の整数で入力してください。" });
        return;
      }
      if (rawDays.reduce((sum, value) => sum + value, 0) > 60) {
        setNotice({ type: "error", text: "計画の合計期間は60日以内にしてください。" });
        return;
      }
    }

    setSaving(true);
    setNotice(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      router.push("/auth/login");
      return;
    }

    const phaseDays =
      planForm.duration === "custom"
        ? normalizedPhaseDays(planForm.prepDays, planForm.mainDays, planForm.recoveryDays)
        : legacyPlanDays(Number(planForm.duration));
    const duration = phaseDays.prep_days + phaseDays.main_days + phaseDays.recovery_days;
    const consentPayload = {
      safety_consent_version: SAFETY_CONSENT_VERSION,
      safety_confirmations: {
        pregnancy_or_nursing: safetyChecks.pregnancy,
        prior_medical_consultation: safetyChecks.consultation,
        stop_and_seek_care_when_unwell: safetyChecks.stopWhenUnwell,
      },
      safety_notice_text: SAFETY_NOTICE_TEXT,
    };

    const modernPayload = {
      user_id: user.id,
      start_date: planForm.startDate,
      duration_days: duration,
      ...phaseDays,
      main_drink: planForm.mainDrink,
      notifications_enabled: true,
      status: "active",
      memo: planForm.memo || null,
      ...consentPayload,
    };

    const { error: modernError } = await supabase.from("fasting_plans").insert(modernPayload);
    let error = modernError;

    if (
      isMissingColumnError(modernError, "duration_days") ||
      isMissingColumnError(modernError, "status") ||
      modernError?.message?.includes("duration_days_check") ||
      modernError?.message?.includes("violates check constraint")
    ) {
      const legacyPayload = {
        user_id: user.id,
        start_date: planForm.startDate,
        ...phaseDays,
        main_drink: planForm.mainDrink,
        notifications_enabled: true,
        status: "active",
        memo: planForm.memo || null,
        ...consentPayload,
      };

      const fallback = await supabase.from("fasting_plans").insert(legacyPayload);
      error = fallback.error;

      if (
        isMissingColumnError(error, "main_drink") ||
        isMissingColumnError(error, "notifications_enabled") ||
        isMissingColumnError(error, "status") ||
        isMissingColumnError(error, "memo")
      ) {
        const minimalPayload = {
          user_id: user.id,
          start_date: planForm.startDate,
          ...phaseDays,
          ...consentPayload,
        };
        const minimal = await supabase.from("fasting_plans").insert(minimalPayload);
        error = minimal.error;
      }
    }

    setSaving(false);

    const consentStorageMissing =
      isMissingColumnError(error, "safety_consent_version") ||
      isMissingColumnError(error, "safety_confirmed_at") ||
      isMissingColumnError(error, "safety_confirmations") ||
      isMissingColumnError(error, "safety_notice_text");
    const customDurationConstraintMissing =
      planForm.duration === "custom" &&
      (error?.message?.includes("duration_days_check") ||
        error?.message?.includes("fasting_plans_duration_days") ||
        error?.message?.includes("violates check constraint"));

    if (error) {
      setNotice({
        type: "error",
        text: consentStorageMissing
          ? "安全確認の保存設定が未反映のため、計画を保存しませんでした。管理者がSupabaseの更新を完了してから、もう一度お試しください。"
          : customDurationConstraintMissing
            ? "自由設定の日数を保存するデータベース更新が未反映です。管理者が設定を完了してから、もう一度お試しください。"
          : getUserFacingError(
              error,
              "計画を保存できませんでした。時間をおいてもう一度お試しください。"
            ),
      });
      return;
    }

    let cleanupError = null;
    if (latestPlan?.id) {
      const cleanup = await supabase
        .from("fasting_plans")
        .update({ status: "inactive" })
        .eq("id", latestPlan.id)
        .eq("user_id", user.id);
      if (cleanup.error && !isMissingColumnError(cleanup.error, "status")) {
        cleanupError = cleanup.error;
      }
    }

    setNotice({
      type: cleanupError ? "info" : "success",
      text: cleanupError
        ? "新しい計画は保存されました。以前の計画の整理だけ完了しなかったため、表示を再確認してください。"
        : "ファスティング計画を保存しました。",
    });
    savedPlanForm.current = JSON.stringify(planForm);
    setConfirmResetPlan(false);
    setConfirmReplacePlan(false);
    setSafetyChecks({
      pregnancy: false,
      consultation: false,
      stopWhenUnwell: false,
    });
    loadData();
  };

  const resetPlan = async () => {
    if (!latestPlan?.id) return;

    setSaving(true);
    setNotice(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      router.push("/auth/login");
      return;
    }

    const updated = await supabase
      .from("fasting_plans")
      .update({ status: "canceled" })
      .eq("id", latestPlan.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    const error =
      updated.error ??
      (updated.data ? null : { message: "計画の更新対象が見つかりませんでした。" });

    setSaving(false);

    if (error) {
      const statusConstraintMissing =
        error.message?.includes("check constraint") ||
        error.message?.includes("fasting_plans_status");
      setNotice({
        type: "error",
        text: statusConstraintMissing
          ? "取消状態を保存するデータベース更新が未反映です。管理者が設定を完了してから、もう一度お試しください。"
          : getUserFacingError(
              error,
              "計画をリセットできませんでした。時間をおいてもう一度お試しください。"
            ),
      });
      return;
    }

    setConfirmResetPlan(false);
    setLatestPlan(null);
    savedPlanForm.current = JSON.stringify(planForm);
    setNotice({ type: "success", text: "ファスティング計画をリセットしました。" });
    loadData();
  };

  const saveRecord = async () => {
    const waterLiters = recordForm.water ? Number(recordForm.water) : null;
    const sleepHours = recordForm.sleep ? Number(recordForm.sleep) : null;
    const fastingHours = latestIntervalHours === null ? null : Math.round(latestIntervalHours * 10) / 10;
    const hungerLevel = Number(recordForm.hunger);

    if (waterLiters !== null && (!Number.isFinite(waterLiters) || waterLiters < 0 || waterLiters > 10)) {
      setNotice({ type: "error", text: "水分量は0から10Lの範囲で入力してください。" });
      return;
    }
    if (sleepHours !== null && (!Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 24)) {
      setNotice({ type: "error", text: "睡眠時間は0から24時間の範囲で入力してください。" });
      return;
    }
    if (!Number.isInteger(hungerLevel) || hungerLevel < 1 || hungerLevel > 5) {
      setNotice({ type: "error", text: "空腹感を1から5の範囲で選択してください。" });
      return;
    }
    if (recordForm.discomfort.length > 300 || recordForm.meal.length > 500 || recordForm.memo.length > 500) {
      setNotice({ type: "error", text: "不調は300文字、食事・飲み物とメモは各500文字以内で入力してください。" });
      return;
    }

    setSaving(true);
    setNotice(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      router.push("/auth/login");
      return;
    }

    const conditionPayload = {
      user_id: user.id,
      recorded_date: today,
      water_ml: waterLiters !== null ? Math.round(waterLiters * 1000) : null,
      hunger_level: hungerLevel,
      condition: recordForm.condition,
      sleep_hours: sleepHours,
      bowel_movement: recordForm.bowelMovement,
      swelling: recordForm.swelling ? "slight" : "none",
      discomfort: recordForm.discomfort || null,
      meal_log: recordForm.meal || null,
      eating_time: enteredMealTimes[enteredMealTimes.length - 1] || null,
      meal_times: enteredMealTimes,
      fasting_hours: fastingHours,
      memo: recordForm.memo || null,
    };
    const saveCondition = async () => {
      const upsert = await supabase.from("daily_conditions").upsert(conditionPayload, { onConflict: "user_id,recorded_date" });
      if (!upsert.error) return null;

      const update = await supabase
        .from("daily_conditions")
        .update(conditionPayload)
        .eq("user_id", user.id)
        .eq("recorded_date", today)
        .select("id")
        .maybeSingle();
      if (!update.error && update.data) return null;

      const insert = await supabase.from("daily_conditions").insert(conditionPayload);
      return insert.error ?? update.error ?? upsert.error;
    };

    const conditionError = await saveCondition();

    setSaving(false);

    if (conditionError) {
      setNotice({
        type: "error",
        text: getUserFacingError(
          conditionError,
          "体調記録を保存できませんでした。時間をおいてもう一度お試しください。",
          {
            duplicateMessage:
              "今日の体調記録を更新できませんでした。画面を再読み込みしてください。",
          }
        ),
      });
      return;
    }

    setNotice({ type: "success", text: "今日の体調を記録しました。" });
    savedRecordForm.current = JSON.stringify(recordForm);
    loadData();
  };

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <h1 className="text-3xl font-bold tracking-normal">ファスティング</h1>
          <p className="mt-2 text-base text-stone-400">計画・体調記録・AIチェック</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          {loading ? (
            <EmptyState title="読み込み中..." description="ファスティング情報を確認しています。" />
          ) : loadError ? (
            <section className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <p className="text-base font-bold text-red-700">読み込みに失敗しました</p>
              <p className="mt-2 text-sm leading-6 text-stone-500">{loadError}</p>
              <button
                type="button"
                onClick={loadData}
                className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white"
              >
                再読み込み
              </button>
            </section>
          ) : !paid ? (
            <LockedPlan />
          ) : !fastingEligibility.eligible ? (
            <EligibilityBlocked reason={fastingEligibility.reason} />
          ) : (
            <>
              <section className="rounded-[22px] bg-[#5d9997] p-5 text-white shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white/70">現在の状態</p>
                    <h2 className="mt-2 text-3xl font-light">{phase?.label ?? "未設定"}</h2>
                    <p className="mt-2 text-sm font-bold text-white/70">{phase?.description ?? "計画を作成して始めましょう。"}</p>
                  </div>
                  <span className="rounded-full bg-white/15 px-3 py-2 text-sm font-bold">
                    {latestPlan ? `${phase?.day ?? 0}/${phase?.total ?? days.total}日` : "計画なし"}
                  </span>
                </div>
                <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-white" style={{ width: `${phase?.progress ?? 0}%` }} />
                </div>
                {latestPlan ? (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-bold text-white/80">
                    <div className="rounded-2xl bg-white/15 px-2 py-3">準備 {days.prep}日</div>
                    <div className="rounded-2xl bg-white/15 px-2 py-3">本番 {days.main}日</div>
                    <div className="rounded-2xl bg-white/15 px-2 py-3">回復 {days.recovery}日</div>
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl bg-white/15 px-4 py-3 text-sm font-bold text-white/80">
                    下の「計画」から開始日と期間を保存できます。
                  </p>
                )}
              </section>

              <section className="rounded-2xl bg-white p-2 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                <div className="grid grid-cols-4 gap-1">
                  {[
                    ["plan", "計画"],
                    ["guide", "ガイド"],
                    ["record", "体調"],
                    ["ai", "AI"],
                  ].map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key as Tab)} className={`rounded-xl py-2 text-sm font-bold transition ${tab === key ? "bg-[#5d9997] text-white" : "text-stone-500"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {notice && <p className={`rounded-xl border px-3 py-2 text-sm ${noticeClass[notice.type]}`}>{notice.text}</p>}

              {tab === "plan" && (
                <div className="space-y-4">
                  <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold">ファスティング計画</h2>
                        <p className="mt-1 text-sm text-stone-400">開始日と期間を選んで保存します</p>
                      </div>
                      {latestPlan && (
                        <button
                          type="button"
                          onClick={() => setConfirmResetPlan(true)}
                          className="shrink-0 rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-500"
                        >
                          リセット
                        </button>
                      )}
                    </div>
                    {latestPlan && (
                      <div className="mt-4 rounded-2xl bg-teal-50 px-4 py-3 text-sm leading-6 text-[#4d8b8a]">
                        <p className="font-bold">
                          現在の計画：{formatDate(latestPlan.start_date)}開始・{days.total}日間
                        </p>
                        <p>
                          準備{days.prep}日 / 本番{days.main}日 / 回復{days.recovery}日
                        </p>
                      </div>
                    )}
                    {confirmResetPlan && (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-bold text-amber-900">この計画をリセットしますか？</p>
                        <p className="mt-1 text-sm leading-6 text-amber-800">
                          スケジュール表示を未設定に戻します。体重や体調の記録は残ります。
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmResetPlan(false)}
                            className="rounded-xl border border-stone-200 bg-white py-3 text-sm font-bold text-stone-500"
                          >
                            やめる
                          </button>
                          <button
                            type="button"
                            onClick={resetPlan}
                            disabled={saving}
                            className="rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white disabled:opacity-60"
                          >
                            {saving ? "処理中..." : "リセットする"}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="mt-4 space-y-4">
                      <Field label="開始日">
                        <input type="date" value={planForm.startDate} onChange={(event) => setPlanForm({ ...planForm, startDate: event.target.value })} className={inputClass} />
                      </Field>
                      <div>
                        <p className="mb-2 text-sm font-bold text-slate-600">期間</p>
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            ["3", "3日"],
                            ["5", "5日"],
                            ["7", "7日"],
                            ["custom", "自由"],
                          ].map(([value, label]) => (
                            <button key={value} onClick={() => setPlanForm({ ...planForm, duration: value as DurationOption })} className={`rounded-xl border px-2 py-3 text-sm font-bold ${planForm.duration === value ? "border-[#5d9997] bg-teal-50 text-[#4d8b8a]" : "border-stone-200 text-stone-500"}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {planForm.duration === "custom" && (
                        <div className="rounded-2xl bg-stone-50 p-4">
                          <p className="mb-3 text-sm font-bold text-slate-600">各期間の日数</p>
                          <div className="grid grid-cols-3 gap-2">
                            <label className="block">
                              <span className="mb-1 block text-xs font-bold text-stone-500">準備</span>
                              <input className={inputClass} value={planForm.prepDays} onChange={(event) => setPlanForm({ ...planForm, prepDays: event.target.value })} type="number" min="1" max="14" />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs font-bold text-stone-500">本番</span>
                              <input className={inputClass} value={planForm.mainDays} onChange={(event) => setPlanForm({ ...planForm, mainDays: event.target.value })} type="number" min="1" max="14" />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs font-bold text-stone-500">回復</span>
                              <input className={inputClass} value={planForm.recoveryDays} onChange={(event) => setPlanForm({ ...planForm, recoveryDays: event.target.value })} type="number" min="1" max="14" />
                            </label>
                          </div>
                          <p className="mt-3 text-sm font-bold text-[#4d8b8a]">
                            合計 {normalizedPhaseDays(planForm.prepDays, planForm.mainDays, planForm.recoveryDays).prep_days + normalizedPhaseDays(planForm.prepDays, planForm.mainDays, planForm.recoveryDays).main_days + normalizedPhaseDays(planForm.prepDays, planForm.mainDays, planForm.recoveryDays).recovery_days}日間
                          </p>
                        </div>
                      )}
                      <Field label="本番日の飲み物">
                        <select value={planForm.mainDrink} onChange={(event) => setPlanForm({ ...planForm, mainDrink: event.target.value })} className={inputClass}>
                          <option>ミキ</option>
                          <option>甘酒</option>
                          <option>発酵ドリンク</option>
                          <option>その他</option>
                        </select>
                      </Field>
                      <textarea value={planForm.memo} onChange={(event) => setPlanForm({ ...planForm, memo: event.target.value })} className={`${inputClass} resize-none`} rows={3} placeholder="予定や注意したいこと" />
                      <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6">
                        <p className="font-bold text-slate-700">保存予定</p>
                        <p className="mt-1 text-stone-500">
                          {formatDate(planForm.startDate)}から{formatDate(previewEndDate)}まで、合計{previewTotal}日間です。
                        </p>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold text-stone-600">
                          <div className="rounded-xl bg-white px-2 py-2">準備 {previewDays.prep_days}日</div>
                          <div className="rounded-xl bg-white px-2 py-2">本番 {previewDays.main_days}日</div>
                          <div className="rounded-xl bg-white px-2 py-2">回復 {previewDays.recovery_days}日</div>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-bold text-amber-900">開始前の安全確認</p>
                        <p className="mt-2 text-sm leading-6 text-amber-800">
                          すべて確認すると計画を保存できます。確認内容・確認日時・文面の版は、計画履歴とともに保存されます。
                        </p>
                        <div className="mt-3 space-y-2">
                          <SafetyCheck
                            checked={safetyChecks.pregnancy}
                            onChange={(checked) =>
                              setSafetyChecks((current) => ({ ...current, pregnancy: checked }))
                            }
                          >
                            妊娠・授乳中ではなく、18歳以上です
                          </SafetyCheck>
                          <SafetyCheck
                            checked={safetyChecks.consultation}
                            onChange={(checked) =>
                              setSafetyChecks((current) => ({ ...current, consultation: checked }))
                            }
                          >
                            持病・服薬・摂食障害の既往がある場合は、事前に医師などへ相談しました
                          </SafetyCheck>
                          <SafetyCheck
                            checked={safetyChecks.stopWhenUnwell}
                            onChange={(checked) =>
                              setSafetyChecks((current) => ({ ...current, stopWhenUnwell: checked }))
                            }
                          >
                            めまい・動悸・強いだるさなどが出た場合は中止し、必要に応じて受診します
                          </SafetyCheck>
                        </div>
                        {!safetyConfirmed && (
                          <p className="mt-3 text-xs font-bold leading-5 text-amber-800">
                            当てはまらない項目がある場合は、計画を保存せず医師などへ相談してください。
                          </p>
                        )}
                        <p className="mt-2 text-xs leading-5 text-amber-700">
                          このアプリは記録と情報整理を目的としており、医療上の診断や治療を行うものではありません。
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setNotice(null);
                          if (latestPlan) {
                            if (!hasUnsavedPlan) {
                              setNotice({
                                type: "info",
                                text: "計画内容は変更されていません。変更したい項目を入力してください。",
                              });
                              return;
                            }
                            setConfirmReplacePlan(true);
                            return;
                          }
                          void savePlan();
                        }}
                        disabled={saving || !safetyConfirmed || confirmReplacePlan}
                        className="w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white disabled:opacity-50"
                      >
                        {saving ? "保存中..." : latestPlan ? "更新内容を確認" : "計画を保存"}
                      </button>
                      {confirmReplacePlan && latestPlan && (
                        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
                          <p className="text-sm font-bold text-slate-800">この内容に更新しますか？</p>
                          <p className="mt-1 text-sm leading-6 text-stone-600">
                            体重や体調の記録は残り、ファスティング予定だけが新しい内容に変わります。
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs leading-5">
                            <div className="rounded-xl bg-white p-3">
                              <p className="font-bold text-stone-400">現在</p>
                              <p className="mt-1 font-bold text-slate-700">
                                {formatDate(latestPlan.start_date)}から{days.total}日間
                              </p>
                            </div>
                            <div className="rounded-xl bg-white p-3">
                              <p className="font-bold text-[#4d8b8a]">更新後</p>
                              <p className="mt-1 font-bold text-slate-700">
                                {formatDate(planForm.startDate)}から{previewTotal}日間
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmReplacePlan(false)}
                              disabled={saving}
                              className="rounded-xl border border-stone-200 bg-white py-3 text-sm font-bold text-stone-500 disabled:opacity-60"
                            >
                              修正する
                            </button>
                            <button
                              type="button"
                              onClick={savePlan}
                              disabled={saving}
                              className="rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white disabled:opacity-60"
                            >
                              {saving ? "更新中..." : "この内容に更新"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  <ScheduleCard schedule={schedule} />
                </div>
              )}

              {tab === "guide" && <GuideSection phase={phase} latestPlan={latestPlan} />}

              {tab === "record" && (
                <div className="space-y-4">
                  <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                    <h2 className="text-lg font-bold">{conditionTitle}</h2>
                    <p className="mt-1 text-sm text-stone-400">{conditionDescription}</p>
                    <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-sm font-bold text-slate-600">水分（L）</span>
                        <input className={inputClass} placeholder="例：1.5" value={recordForm.water} onChange={(event) => setRecordForm({ ...recordForm, water: event.target.value })} type="number" inputMode="decimal" min="0" max="10" step="0.1" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-bold text-slate-600">睡眠（時間）</span>
                        <input className={inputClass} placeholder="例：7" value={recordForm.sleep} onChange={(event) => setRecordForm({ ...recordForm, sleep: event.target.value })} type="number" inputMode="decimal" min="0" max="24" step="0.5" />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-sm font-bold text-slate-600">空腹感 {recordForm.hunger}</span>
                      <input className="w-full accent-[#5d9997]" value={recordForm.hunger} onChange={(event) => setRecordForm({ ...recordForm, hunger: event.target.value })} type="range" min="1" max="5" />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-sm font-bold text-slate-600">体調</span>
                        <select className={inputClass} value={recordForm.condition} onChange={(event) => setRecordForm({ ...recordForm, condition: event.target.value })}>
                          <option>よい</option>
                          <option>ふつう</option>
                          <option>少しつらい</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-bold text-slate-600">お通じ</span>
                        <select className={inputClass} value={recordForm.bowelMovement} onChange={(event) => setRecordForm({ ...recordForm, bowelMovement: event.target.value })}>
                          <option>なし</option>
                          <option>あり</option>
                        </select>
                      </label>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold text-slate-600">食べた時間</span>
                        <button
                          type="button"
                          onClick={() => setRecordForm({ ...recordForm, eatingTimes: [...recordForm.eatingTimes, ""] })}
                          className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#4d8b8a] shadow-sm"
                        >
                          ＋ 時間を追加
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {recordForm.eatingTimes.map((time, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              aria-label={`食べた時間 ${index + 1}`}
                              className={inputClass}
                              type="time"
                              value={time}
                              onChange={(event) => {
                                const eatingTimes = [...recordForm.eatingTimes];
                                eatingTimes[index] = event.target.value;
                                setRecordForm({ ...recordForm, eatingTimes });
                              }}
                            />
                            {recordForm.eatingTimes.length > 1 && (
                              <button
                                type="button"
                                aria-label={`食べた時間 ${index + 1}を削除`}
                                onClick={() => setRecordForm({ ...recordForm, eatingTimes: recordForm.eatingTimes.filter((_, itemIndex) => itemIndex !== index) })}
                                className="rounded-full px-2 py-2 text-sm font-bold text-stone-400"
                              >
                                削除
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm leading-6 text-stone-600">
                        {latestIntervalHours !== null && latestIntervalHours >= 0 ? (
                          <p><span className="font-bold text-[#4d8b8a]">前回の食事から {latestIntervalHours.toFixed(1)}時間</span> 空いています。</p>
                        ) : (
                          <p>2回分の食事時刻が記録されると、食べていない時間を自動計算します。</p>
                        )}
                        {nextMealGuide && (
                          <p className="mt-1">
                            16時間空ける場合の次の目安は
                            <span className="ml-1 font-bold text-slate-700">
                              {nextMealGuide.getDate() !== localDate(today).getDate() ? "翌日 " : ""}
                              {nextMealGuide.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            です。
                          </p>
                        )}
                        <p className="mt-2 text-xs text-stone-400">目安の達成より体調を優先し、つらい時は食事を取ってください。</p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 rounded-xl bg-stone-50 px-4 py-3 text-sm font-bold text-slate-600">
                      <input type="checkbox" checked={recordForm.swelling} onChange={(event) => setRecordForm({ ...recordForm, swelling: event.target.checked })} />
                      むくみがある
                    </label>
                    <textarea className={`${inputClass} resize-none`} value={recordForm.discomfort} onChange={(event) => setRecordForm({ ...recordForm, discomfort: event.target.value })} rows={2} maxLength={300} placeholder="不調があれば記録" />
                    {isDuringFasting && (
                      <label className="block">
                        <span className="mb-1 block text-sm font-bold text-slate-600">食事・飲み物</span>
                        <textarea
                          className={`${inputClass} resize-none`}
                          value={recordForm.meal}
                          onChange={(event) => setRecordForm({ ...recordForm, meal: event.target.value })}
                          rows={3}
                          maxLength={500}
                          placeholder="例：発酵ドリンク、白湯、具なし味噌汁など"
                        />
                      </label>
                    )}
                    <textarea className={`${inputClass} resize-none`} value={recordForm.memo} onChange={(event) => setRecordForm({ ...recordForm, memo: event.target.value })} rows={3} maxLength={500} placeholder="メモ" />
                    <button onClick={saveRecord} disabled={saving} className="w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white disabled:opacity-60">
                      {saving ? "保存中..." : "体調を記録する"}
                    </button>
                    </div>
                  </section>
                  <ConditionHistory records={conditionHistory} />
                </div>
              )}

              {tab === "ai" && <AiPreview phase={phase} recordForm={recordForm} latestPlan={latestPlan} />}
            </>
          )}
        </main>
      </div>

      <Navigation active="fasting" />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ConditionHistory({ records }: { records: PlanRow[] }) {
  if (records.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <p className="text-base font-bold text-stone-500">体調メモはまだありません</p>
        <p className="mt-2 text-sm leading-6 text-stone-400">記録すると、最近の体調がここに表示されます。</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">最近の体調メモ</h2>
          <p className="mt-1 text-sm text-stone-400">直近5件まで表示します</p>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-[#4d8b8a]">
          {records.length}件
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {records.map((record) => {
          return (
          <article key={record.id ?? record.recorded_date} className="rounded-2xl bg-stone-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-stone-400">{formatDate(record.recorded_date)}</p>
                <p className="mt-1 text-base font-bold text-slate-800">体調 {record.condition || "未記録"}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-stone-500">
                空腹感 {record.hunger_level || "-"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold text-stone-500">
              <div className="rounded-xl bg-white px-2 py-2">
                水分 {record.water_ml ? `${Number(record.water_ml) / 1000}L` : "--"}
              </div>
              <div className="rounded-xl bg-white px-2 py-2">
                睡眠 {record.sleep_hours ? `${record.sleep_hours}h` : "--"}
              </div>
              <div className="rounded-xl bg-white px-2 py-2">
                お通じ {record.bowel_movement ?? "--"}
              </div>
            </div>
            {(recordMealTimes(record).length > 0 || record.fasting_hours !== null && record.fasting_hours !== undefined) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-stone-500">
                {recordMealTimes(record).length > 0 && <span className="rounded-full bg-white px-3 py-1.5">食べた時間 {recordMealTimes(record).join("、")}</span>}
                {record.fasting_hours !== null && record.fasting_hours !== undefined && <span className="rounded-full bg-white px-3 py-1.5">食べていない時間 {record.fasting_hours}時間</span>}
              </div>
            )}
            {record.meal_log && (
              <div className="mt-3 rounded-xl bg-white px-3 py-3">
                <p className="text-xs font-bold text-[#4d8b8a]">食事・飲み物</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-600">{record.meal_log}</p>
              </div>
            )}
            {(record.discomfort || record.memo || (record.swelling && record.swelling !== "none")) && (
              <p className="mt-3 text-sm leading-6 text-stone-500">
                {record.swelling && record.swelling !== "none" ? "むくみあり。 " : ""}
                {[record.discomfort, record.memo].filter(Boolean).join(" / ")}
              </p>
            )}
          </article>
          );
        })}
      </div>
    </section>
  );
}

function LockedPlan() {
  return (
    <section className="overflow-hidden rounded-[22px] bg-white shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <div className="bg-[#5d9997] p-5 text-white">
        <p className="text-sm font-bold text-white/70">有料プラン機能</p>
        <h2 className="mt-2 text-2xl font-bold">ファスティングを計画する</h2>
        <p className="mt-2 text-sm leading-6 text-white/80">
          準備期・本番期・回復期をまとめて管理する画面です。
        </p>
      </div>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between rounded-2xl bg-teal-50 px-4 py-3">
          <div>
            <p className="text-xs font-bold text-stone-400">対象プラン</p>
            <p className="mt-1 text-sm font-bold text-slate-800">本格ファスティングAIプラン</p>
          </div>
          <p className="text-sm font-bold text-[#4d8b8a]">月額1,980円</p>
        </div>
        <div className="space-y-3">
          {[
            ["📅", "スケジュール", "開始日と3日・5日・7日の流れを保存できます。"],
            ["🥣", "回復食ガイド", "終わったあとの食事をやさしく戻す目安を見られます。"],
            ["✨", "AI提案", "記録をもとに過ごし方のヒントを出す予定です。"],
          ].map(([icon, title, description]) => (
            <div key={title} className="flex gap-3 rounded-2xl bg-stone-50 p-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-xl">{icon}</div>
              <div>
                <p className="font-bold text-slate-800">{title}</p>
                <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
              </div>
            </div>
          ))}
        </div>
        <Link href="/premium" className="mt-5 block rounded-xl bg-slate-900 py-3 text-center text-base font-bold text-white">
          機能と料金を見る
        </Link>
        <p className="mt-2 text-center text-xs leading-5 text-stone-400">
          内容を確認してからプランを変更できます。
        </p>
      </div>
    </section>
  );
}

function SafetyCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl bg-white px-3 py-3 text-sm font-bold leading-6 text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#5d9997]"
      />
      <span>{children}</span>
    </label>
  );
}

function EligibilityBlocked({ reason }: { reason: string }) {
  return (
    <section className="overflow-hidden rounded-[22px] bg-white shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <div className="bg-amber-50 p-5">
        <p className="text-sm font-bold text-amber-700">安全のため利用を停止しています</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">ファスティング機能を利用できません</h2>
        <p className="mt-3 text-sm leading-7 text-amber-900">{reason}</p>
      </div>
      <div className="p-5">
        <p className="text-sm leading-7 text-stone-500">
          体重記録やグラフは引き続き利用できます。登録情報が古い場合は、最新の体重と身長を確認してください。
        </p>
        <Link
          href="/settings"
          className="mt-4 block rounded-xl bg-[#5d9997] py-3 text-center text-base font-bold text-white"
        >
          登録情報を確認する
        </Link>
      </div>
    </section>
  );
}

function ScheduleCard({ schedule }: { schedule: Array<{ date: string; label: string; description: string; active: boolean }> }) {
  if (schedule.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <p className="text-base font-bold text-stone-500">スケジュールは未設定です</p>
        <p className="mt-2 text-sm leading-6 text-stone-400">計画を保存すると、日ごとの流れがここに表示されます。</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">スケジュール</h2>
          <p className="mt-1 text-sm text-stone-400">準備・本番・回復の流れ</p>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-[#4d8b8a]">{schedule.length}日間</span>
      </div>
      <div className="mt-4 space-y-3">
        {schedule.map((item, index) => (
          <article
            key={`${item.date}-${index}`}
            className={`rounded-2xl border p-4 ${
              item.active ? "border-[#5d9997] bg-teal-50" : "border-stone-100 bg-stone-50"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-stone-400">{formatDate(item.date)}</p>
                <h3 className="mt-1 text-base font-bold text-slate-800">
                  {index + 1}日目・{item.label}
                </h3>
              </div>
              {item.active && <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#4d8b8a]">今日</span>}
            </div>
            <p className="mt-2 text-sm leading-6 text-stone-500">{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GuideSection({ phase, latestPlan }: { phase: ReturnType<typeof getPhase>; latestPlan: PlanRow | null }) {
  const guide = getPhaseGuide(phase, latestPlan?.main_drink ?? "発酵ドリンク");
  const planDays = getPlanDays(latestPlan);
  const prepMenus = latestPlan
    ? PREP_MEAL_MENUS.slice(0, Math.min(Math.max(planDays.prep, 1), 2))
    : PREP_MEAL_MENUS;
  const currentPrepDay =
    phase?.label === phases.prep.label ? Math.min(phase.day, 2) : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <p className="text-sm font-bold text-[#5d9997]">今の状態に合わせたガイド</p>
        <h2 className="mt-1 text-lg font-bold">{guide.title}</h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">{guide.description}</p>
        <div className="mt-4 space-y-2">
          {guide.items.map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl bg-stone-50 px-4 py-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-[#5d9997]">✓</span>
              <p className="text-sm font-bold text-stone-600">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <p className="text-sm font-bold text-[#5d9997]">準備期のメニュー</p>
        <h2 className="mt-1 text-lg font-bold">本番へ向けた食事例</h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          揚げ物、肉料理、甘いお菓子、アルコール、カフェインを控え、おかゆと温かい汁物を中心にします。
        </p>
        <div className="mt-4 space-y-4">
          {prepMenus.map((menu) => (
            <article key={menu.day} className="overflow-hidden rounded-2xl border border-stone-100">
              <div className="flex items-start justify-between gap-3 bg-stone-50 px-4 py-3">
                <div>
                  <h3 className="text-base font-bold text-slate-800">{menu.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-stone-500">{menu.description}</p>
                </div>
                {currentPrepDay === menu.day && (
                  <span className="shrink-0 rounded-full bg-[#5d9997] px-3 py-1 text-xs font-bold text-white">今日</span>
                )}
              </div>
              <div className="divide-y divide-stone-100 px-4">
                {menu.meals.map((meal) => (
                  <div key={meal.label} className="grid grid-cols-[36px_1fr] gap-3 py-3">
                    <span className="text-sm font-bold text-[#4d8b8a]">{meal.label}</span>
                    <p className="text-sm leading-6 text-stone-600">{meal.menu}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <p className="text-sm font-bold text-[#5d9997]">本番期の空腹時</p>
        <h2 className="mt-1 text-lg font-bold">無理をしないための目安</h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          救済食を取ることは失敗ではありません。空腹の強さと体調を分けて考え、安全を優先します。
        </p>
        <div className="mt-4 space-y-2">
          {FASTING_SUPPORT_GUIDE.map((item) => (
            <article key={item.level} className={`rounded-2xl px-4 py-3 ${item.tone}`}>
              <h3 className="text-sm font-bold">{item.level}</h3>
              <p className="mt-1 text-sm leading-6">{item.action}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-stone-400">
          体調や持病、服薬状況には個人差があります。このガイドは診断や治療の代わりではありません。
        </p>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <h2 className="text-lg font-bold">回復食ガイド</h2>
        <p className="mt-1 text-sm leading-6 text-stone-400">ファスティング後は、戻し方が大事です。少量からゆっくり進めます。</p>
        <div className="mt-4 space-y-3">
          {RECOVERY_GUIDE.map((item) => (
            <article key={item.title} className="rounded-2xl bg-stone-50 p-4">
              <p className="text-sm font-bold text-[#4d8b8a]">{item.title}</p>
              <h3 className="mt-1 text-base font-bold text-slate-800">{item.foods}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-500">{item.note}</p>
            </article>
          ))}
        </div>
        <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm leading-6 text-rose-700">
          めまい、強いだるさ、動悸などがある時は無理に続けず、中止や医療機関への相談も選択肢にしてください。
        </div>
      </section>
    </div>
  );
}

function AiPreview({
  phase,
  recordForm,
  latestPlan,
}: {
  phase: ReturnType<typeof getPhase>;
  recordForm: {
    water: string;
    hunger: string;
    condition: string;
    sleep: string;
    bowelMovement: string;
    swelling: boolean;
    discomfort: string;
    meal: string;
    eatingTimes: string[];
    memo: string;
  };
  latestPlan: PlanRow | null;
}) {
  const hunger = Number(recordForm.hunger || 0);
  const water = Number(recordForm.water || 0);
  const sleep = Number(recordForm.sleep || 0);
  const tips = [
    hunger >= 4
      ? "空腹感が強めです。温かい飲み物をゆっくり飲み、予定を詰めすぎない日にしましょう。"
      : "空腹感は落ち着いています。水分をこまめに取りながら、今のペースを保ちましょう。",
    water > 0 && water < 1.5
      ? "水分が少なめです。午前と午後に分けて、少しずつ足していくのがおすすめです。"
      : "水分記録も見ながら、カフェインに偏りすぎないようにしましょう。",
    sleep > 0 && sleep < 6
      ? "睡眠が短めです。今日は強い運動より、早めに休むことを優先してください。"
      : "睡眠と体調に大きな崩れがなければ、軽い散歩くらいの活動が合いやすいです。",
  ];

  const phaseLabel = phase?.label ?? "未設定";
  const mainDrink = latestPlan?.main_drink ?? "発酵ドリンク";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#5d9997]">AI提案プレビュー</p>
            <h2 className="mt-1 text-lg font-bold">今日の過ごし方</h2>
          </div>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500">準備中</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-stone-500">
          実際のAI連携前の見本です。体調記録、空腹感、水分、睡眠をもとに、当日の注意点を出す想定です。
        </p>
        <div className="mt-4 rounded-2xl bg-[#5d9997] p-4 text-white">
          <p className="text-xs font-bold text-white/70">現在の期間</p>
          <p className="mt-1 text-2xl font-light">{phaseLabel}</p>
          <p className="mt-2 text-sm font-bold text-white/75">本番日の飲み物：{mainDrink}</p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <h2 className="text-lg font-bold">今日のヒント</h2>
        <div className="mt-4 space-y-3">
          {tips.map((tip, index) => (
            <div key={tip} className="flex gap-3 rounded-2xl bg-stone-50 p-4">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-[#5d9997]">
                {index + 1}
              </div>
              <p className="text-sm leading-6 text-stone-600">{tip}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
        <h2 className="text-lg font-bold">食事写真チェック</h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          回復食や通常食の写真から、量・油分・たんぱく質・野菜量の傾向を確認する機能として追加予定です。
        </p>
        <div className="mt-4 rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-400">
          写真アップロードとAI判定は準備中です
        </div>
      </section>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <p className="text-base font-bold text-stone-500">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-400">{description}</p>
    </section>
  );
}
