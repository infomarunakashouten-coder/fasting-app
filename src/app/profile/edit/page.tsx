"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { getMinimumWeightForBmi } from "@/lib/fasting-eligibility";
import { validateProfileFields } from "@/lib/profile-validation";
import { calcBMI, createClient, getBMICategory } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { Gender } from "@/types";

const AVATARS = Array.from({ length: 10 }, (_, index) => `/avatar_${String(index + 1).padStart(2, "0")}.png`);
const localBirthDateKey = "fastingBirthDate";

const inputClass =
  "w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50";

const avatarPathFromSeed = (seed?: string | number | null) => {
  const index = Number(String(seed ?? "").replace("mio", ""));
  if (!Number.isFinite(index) || index < 1 || index > 10) return null;
  return `/avatar_${String(index).padStart(2, "0")}.png`;
};

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

const getMissingColumnName = (error: { message?: string | null } | null) => {
  const message = error?.message ?? "";
  return (
    message.match(/Could not find the '([^']+)' column/i)?.[1] ??
    message.match(/column ["']?([a-z0-9_]+)["']? does not exist/i)?.[1] ??
    null
  );
};

export default function ProfileEditPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [profileSource, setProfileSource] = useState<"new" | "old" | null>(null);
  const savedForm = useRef("");
  const [form, setForm] = useState({
    nickname: "",
    birthDate: "",
    age: "",
    gender: "" as Gender | "",
    height: "",
    currentWeight: "",
    goalWeight: "",
    bodyFat: "",
    muscleMass: "",
    waist: "",
    menstrualCycle: "",
    sleepHours: "",
    avatarPath: "/avatar_01.png",
  });
  const formSnapshot = JSON.stringify(form);
  useUnsavedChanges(!loading && !saving && savedForm.current !== "" && formSnapshot !== savedForm.current);

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

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

    const [newProfile, oldProfile] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    if (newProfile.error && oldProfile.error) {
      setLoadError(
        getUserFacingError(
          newProfile.error,
          "プロフィールを読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    const row = mergeProfileRows(newProfile.data, oldProfile.data);
    if (!row) {
      router.push("/profile/setup");
      return;
    }
    setProfileSource(newProfile.data ? "new" : "old");

    const avatarPath =
      row.avatar_path ??
      row.avatar_url ??
      row.avatar ??
      avatarPathFromSeed(row.avatar_seed) ??
      window.localStorage.getItem("fastingAvatarPath") ??
      "/avatar_01.png";
    const savedBirthDate = window.localStorage.getItem(localBirthDateKey);
    const birthDate = row.birth_date || savedBirthDate || "";

    const nextForm = {
      nickname: row.nickname ?? "",
      birthDate,
      age: birthDate ? calculateAge(birthDate) : (row.age ?? "").toString(),
      gender: (row.gender as Gender) ?? "",
      height: (row.height_cm ?? row.height ?? "").toString(),
      currentWeight: (row.current_weight_kg ?? row.current_weight ?? "").toString(),
      goalWeight: (row.goal_weight_kg ?? row.goal_weight ?? "").toString(),
      bodyFat: (row.body_fat_percentage ?? "").toString(),
      muscleMass: (row.muscle_mass_kg ?? "").toString(),
      waist: (row.waist_cm ?? "").toString(),
      menstrualCycle: (row.menstrual_cycle_days ?? "").toString(),
      sleepHours: (row.sleep_hours ?? "").toString(),
      avatarPath,
    };
    setForm(nextForm);
    savedForm.current = JSON.stringify(nextForm);

    setLoading(false);
  };

  const currentBMI = useMemo(() => {
    if (!form.currentWeight || !form.height) return null;
    return calcBMI(Number(form.currentWeight), Number(form.height));
  }, [form.currentWeight, form.height]);
  const minimumGoalWeight = form.height
    ? getMinimumWeightForBmi(Number(form.height))
    : null;

  const handleSave = async () => {
    if (!form.nickname || !(form.birthDate || form.age) || !form.gender || !form.height || !form.currentWeight) {
      setError("必須項目を入力してください。");
      return;
    }

    const validationError = validateProfileFields({
      birthDate: form.birthDate,
      height: form.height,
      currentWeight: form.currentWeight,
      goalWeight: form.goalWeight,
      bodyFat: form.bodyFat,
      muscleMass: form.muscleMass,
      waist: form.waist,
      menstrualCycle: form.menstrualCycle,
      sleepHours: form.sleepHours,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    setSuccess(false);
    if (form.birthDate) {
      window.localStorage.setItem(localBirthDateKey, form.birthDate);
    } else {
      window.localStorage.removeItem(localBirthDateKey);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const previousForm = savedForm.current
      ? (JSON.parse(savedForm.current) as typeof form)
      : null;
    const changed = (key: keyof typeof form) =>
      !previousForm || previousForm[key] !== form[key];
    const age = form.birthDate ? calculateAge(form.birthDate) : form.age;
    const newUpdate: Record<string, unknown> = {};
    const oldUpdate: Record<string, unknown> = {};
    const setBoth = (column: string, value: unknown) => {
      newUpdate[column] = value;
      oldUpdate[column] = value;
    };

    if (changed("nickname")) setBoth("nickname", form.nickname);
    if (changed("birthDate") || changed("age")) {
      setBoth("age", age ? Number(age) : null);
      setBoth("birth_date", form.birthDate || null);
    }
    if (changed("gender")) setBoth("gender", form.gender);
    if (changed("height")) {
      newUpdate.height_cm = form.height ? Number(form.height) : null;
      oldUpdate.height = form.height ? Number(form.height) : null;
    }
    if (changed("currentWeight")) {
      newUpdate.current_weight_kg = form.currentWeight ? Number(form.currentWeight) : null;
      oldUpdate.current_weight = form.currentWeight ? Number(form.currentWeight) : null;
    }
    if (changed("goalWeight")) {
      newUpdate.goal_weight_kg = form.goalWeight ? Number(form.goalWeight) : null;
      oldUpdate.goal_weight = form.goalWeight ? Number(form.goalWeight) : null;
    }
    if (changed("bodyFat")) {
      setBoth("body_fat_percentage", form.bodyFat ? Number(form.bodyFat) : null);
    }
    if (changed("muscleMass")) {
      setBoth("muscle_mass_kg", form.muscleMass ? Number(form.muscleMass) : null);
    }
    if (changed("waist")) {
      setBoth("waist_cm", form.waist ? Number(form.waist) : null);
    }
    if (changed("menstrualCycle")) {
      setBoth(
        "menstrual_cycle_days",
        form.menstrualCycle ? Number(form.menstrualCycle) : null
      );
    }
    if (changed("sleepHours")) {
      setBoth("sleep_hours", form.sleepHours ? Number(form.sleepHours) : null);
    }
    if (changed("avatarPath")) {
      newUpdate.avatar_path = form.avatarPath;
      setBoth("avatar_seed", form.avatarPath.match(/\d+/)?.[0] ?? "01");
    }

    const updateProfile = async (
      payload: Record<string, unknown>,
      column: "id" | "user_id"
    ) => {
      if (Object.keys(payload).length === 0) return null;
      const compatiblePayload = { ...payload };

      for (let attempt = 0; attempt <= Object.keys(payload).length; attempt += 1) {
        const result = await supabase
          .from("profiles")
          .update(compatiblePayload)
          .eq(column, user.id)
          .select("id")
          .maybeSingle();

        if (!result.error && result.data) return null;

        const missingColumn = getMissingColumnName(result.error);
        if (missingColumn && missingColumn in compatiblePayload) {
          delete compatiblePayload[missingColumn];
          continue;
        }

        return result.error ?? { message: "更新対象のプロフィールがありません" };
      }

      return { message: "プロフィールの保存項目を確認できませんでした" };
    };

    const primarySave =
      profileSource === "old"
        ? await updateProfile(oldUpdate, "user_id")
        : await updateProfile(newUpdate, "id");
    const saveError =
      primarySave?.message === "更新対象のプロフィールがありません"
        ? profileSource === "old"
          ? await updateProfile(newUpdate, "id")
          : await updateProfile(oldUpdate, "user_id")
        : primarySave;

    if (saveError) {
      const friendlyMessage = getUserFacingError(
        saveError,
        "保存できませんでした。少し時間をおいてもう一度お試しください。"
      );
      const diagnosticError = saveError as { code?: string | null; message?: string | null };
      const diagnostic = [diagnosticError.code, diagnosticError.message]
        .filter(Boolean)
        .join(": ");
      setError(diagnostic ? `${friendlyMessage}\nエラー詳細: ${diagnostic}` : friendlyMessage);
      setSaving(false);
      return;
    }

    window.localStorage.setItem("fastingAvatarPath", form.avatarPath);
    savedForm.current = JSON.stringify(form);
    setSuccess(true);
    setSaving(false);
    setTimeout(() => setSuccess(false), 3000);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f1eb]">
        <p className="text-stone-400">読み込み中...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#f5f1eb] px-5 py-8 text-slate-950">
        <main className="mx-auto max-w-[430px]">
          <section className="rounded-[28px] bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-bold text-red-700">読み込みに失敗しました</p>
            <p className="mt-3 text-sm leading-6 text-stone-500">{loadError}</p>
            <button
              type="button"
              onClick={loadProfile}
              className="mt-5 w-full rounded-2xl bg-[#5f9f9b] py-4 font-bold text-white"
            >
              再読み込み
            </button>
            <Link href="/settings" className="mt-4 block text-sm font-bold text-[#5f9f9b]">
              設定に戻る
            </Link>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f1eb] pb-24 text-slate-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-[430px] px-6 py-10">
          <h1 className="text-4xl font-bold">プロフィール</h1>
          <p className="mt-4 text-xl text-stone-400">基本情報を編集</p>
        </div>
      </header>

      <main className="mx-auto max-w-[430px] px-5 py-6">
        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="space-y-5">
            <Field label="アイコン">
              <div className="grid grid-cols-5 gap-3">
                {AVATARS.map((avatar) => (
                  <button key={avatar} type="button" onClick={() => set("avatarPath", avatar)} className={`rounded-full border-4 p-1 ${form.avatarPath === avatar ? "border-[#5f9f9b]" : "border-transparent"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
                  </button>
                ))}
              </div>
            </Field>

            <Field label="ニックネーム" required>
              <input value={form.nickname} onChange={(event) => set("nickname", event.target.value)} className={inputClass} maxLength={20} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="生年月日" required>
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => {
                    const birthDate = event.target.value;
                    if (birthDate) {
                      window.localStorage.setItem(localBirthDateKey, birthDate);
                    } else {
                      window.localStorage.removeItem(localBirthDateKey);
                    }
                    setForm((prev) => ({ ...prev, birthDate, age: calculateAge(birthDate) }));
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="睡眠時間">
                <input type="number" value={form.sleepHours} onChange={(event) => set("sleepHours", event.target.value)} className={inputClass} min={0} max={24} step={0.5} />
              </Field>
            </div>

            <div className="rounded-2xl bg-stone-50 px-4 py-3">
              <p className="text-sm font-bold text-stone-500">年齢</p>
              <p className="mt-1 text-2xl font-light text-[#4d8b8a]">{form.age ? `${form.age}歳` : "--"}</p>
            </div>

            <Field label="性別" required>
              <div className="grid grid-cols-3 gap-2">
                {(["female", "male", "other"] as Gender[]).map((gender) => (
                  <button key={gender} type="button" onClick={() => set("gender", gender)} className={`rounded-2xl border py-4 text-sm font-bold ${form.gender === gender ? "border-[#5f9f9b] bg-teal-50 text-teal-700" : "border-stone-200 text-stone-500"}`}>
                    {gender === "female" ? "女性" : gender === "male" ? "男性" : "その他"}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="身長 cm" required>
                <input type="number" value={form.height} onChange={(event) => set("height", event.target.value)} className={inputClass} step={0.1} />
              </Field>
              <Field label="現在体重 kg" required>
                <input type="number" value={form.currentWeight} onChange={(event) => set("currentWeight", event.target.value)} className={inputClass} step={0.1} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="目標体重 kg">
                <input type="number" value={form.goalWeight} onChange={(event) => set("goalWeight", event.target.value)} className={inputClass} step={0.1} />
              </Field>
              <Field label="体脂肪率 %">
                <input type="number" value={form.bodyFat} onChange={(event) => set("bodyFat", event.target.value)} className={inputClass} step={0.1} />
              </Field>
            </div>
            {minimumGoalWeight !== null && (
              <p className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-500">
                BMI 18.5を下回らない目標体重：
                <span className="font-bold text-[#4d8b8a]">{minimumGoalWeight.toFixed(1)}kg以上</span>
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="筋肉量 kg">
                <input type="number" value={form.muscleMass} onChange={(event) => set("muscleMass", event.target.value)} className={inputClass} step={0.1} />
              </Field>
              <Field label="ウエスト cm">
                <input type="number" value={form.waist} onChange={(event) => set("waist", event.target.value)} className={inputClass} step={0.1} />
              </Field>
            </div>

            {form.gender === "female" && (
              <Field label="生理周期（日）">
                <input type="number" value={form.menstrualCycle} onChange={(event) => set("menstrualCycle", event.target.value)} className={inputClass} min={14} max={90} />
              </Field>
            )}

            {currentBMI && <BmiCard value={currentBMI} />}
            {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
            {success && <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-700">保存しました。</p>}

            <button type="button" onClick={handleSave} disabled={saving} className="w-full rounded-2xl bg-[#5f9f9b] py-4 text-lg font-bold text-white disabled:opacity-60">
              {saving ? "保存中..." : "保存する"}
            </button>
          </div>
        </section>

        <Link href="/settings" className="mt-5 block rounded-2xl bg-white py-4 text-center font-bold text-teal-700 shadow-sm">
          設定に戻る
        </Link>
      </main>

      <Navigation active="settings" />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-stone-600">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function BmiCard({ value }: { value: number }) {
  const category = getBMICategory(value);
  return (
    <div className={`rounded-2xl p-4 ${category.bgColor}`}>
      <p className="text-sm font-bold text-stone-500">現在BMI</p>
      <p className={`mt-1 text-3xl font-bold ${category.color}`}>
        {value.toFixed(1)} <span className="text-base">{category.label}</span>
      </p>
    </div>
  );
}
