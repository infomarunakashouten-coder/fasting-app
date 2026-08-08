"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getMinimumWeightForBmi } from "@/lib/fasting-eligibility";
import { validateProfileFields } from "@/lib/profile-validation";
import { calcBMI, createClient, getBMICategory } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";
import { saveWeightRecord } from "@/lib/weight-records";
import type { Gender } from "@/types";

const STEPS = ["基本情報", "からだ情報", "目標設定"];
const AVATARS = Array.from({ length: 10 }, (_, index) => `/avatar_${String(index + 1).padStart(2, "0")}.png`);
const localBirthDateKey = "fastingBirthDate";

const inputClass =
  "w-full rounded-2xl border border-stone-200 bg-white px-5 py-4 text-base outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50";

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

type DatabaseError = {
  code?: string | null;
  message?: string | null;
};

const getMissingColumn = (error: DatabaseError | null | undefined) => {
  const message = error?.message ?? "";
  const matches = [
    message.match(/Could not find the '([^']+)' column/i),
    message.match(/column (?:profiles\.)?"?([a-z0-9_]+)"? does not exist/i),
  ];
  return matches.find(Boolean)?.[1] ?? null;
};

export default function ProfileSetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const heightInputRef = useRef<HTMLInputElement>(null);
  const goalWeightInputRef = useRef<HTMLInputElement>(null);
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

  const currentBMI = useMemo(() => {
    if (!form.currentWeight || !form.height) return null;
    return calcBMI(Number(form.currentWeight), Number(form.height));
  }, [form.currentWeight, form.height]);

  const goalBMI = useMemo(() => {
    if (!form.goalWeight || !form.height) return null;
    return calcBMI(Number(form.goalWeight), Number(form.height));
  }, [form.goalWeight, form.height]);
  const minimumGoalWeight = form.height
    ? getMinimumWeightForBmi(Number(form.height))
    : null;

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const input =
      step === 1
        ? heightInputRef.current
        : step === 2
          ? goalWeightInputRef.current
          : null;
    if (!input) return;

    const frame = window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const handleNext = () => {
    if (step === 0 && (!form.nickname || !form.birthDate || !form.gender)) {
      setError("ニックネーム、生年月日、性別を入力してください。");
      return;
    }
    if (step === 0) {
      const validationError = validateProfileFields({ birthDate: form.birthDate });
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    if (step === 1 && (!form.height || !form.currentWeight)) {
      setError("身長と現在体重を入力してください。");
      return;
    }
    if (step === 1) {
      const validationError = validateProfileFields({
        height: form.height,
        currentWeight: form.currentWeight,
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
    }
    setError("");
    setStep((value) => value + 1);
  };

  const handleSubmit = async () => {
    if (!form.goalWeight) {
      setError("目標体重を入力してください。");
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

    setLoading(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const age = calculateAge(form.birthDate);
    const avatarSeed = form.avatarPath.match(/\d+/)?.[0] ?? "01";
    const base = {
      nickname: form.nickname,
      age: age ? Number(age) : null,
      birth_date: form.birthDate,
      gender: form.gender as Gender,
      body_fat_percentage: form.bodyFat ? Number(form.bodyFat) : null,
      muscle_mass_kg: form.muscleMass ? Number(form.muscleMass) : null,
      waist_cm: form.waist ? Number(form.waist) : null,
      menstrual_cycle_days: form.menstrualCycle ? Number(form.menstrualCycle) : null,
      sleep_hours: form.sleepHours ? Number(form.sleepHours) : null,
      notifications_enabled: true,
      is_profile_complete: true,
      avatar_seed: avatarSeed,
    };

    const newPayload = {
      ...base,
      height_cm: Number(form.height),
      current_weight_kg: Number(form.currentWeight),
      start_weight_kg: Number(form.currentWeight),
      goal_weight_kg: Number(form.goalWeight),
      avatar_path: form.avatarPath,
    };

    const oldPayload = {
      ...base,
      height: Number(form.height),
      current_weight: Number(form.currentWeight),
      goal_weight: Number(form.goalWeight),
    };

    const updateProfile = async (
      matchColumn: "id" | "user_id",
      initialPayload: Record<string, unknown>
    ) => {
      const payload = { ...initialPayload };

      for (
        let attempt = 0;
        attempt < Object.keys(initialPayload).length + 1;
        attempt += 1
      ) {
        const result = await supabase
          .from("profiles")
          .update(payload)
          .eq(matchColumn, user.id)
          .select("id")
          .maybeSingle();

        if (!result.error && result.data) {
          return { succeeded: true, error: null as DatabaseError | null };
        }

        const missingColumn = getMissingColumn(result.error);
        if (missingColumn && missingColumn in payload) {
          delete payload[missingColumn];
          continue;
        }

        return {
          succeeded: false,
          error:
            result.error ??
            ({
              code: "PROFILE_NOT_FOUND",
              message: `No profile matched ${matchColumn}.`,
            } satisfies DatabaseError),
        };
      }

      return {
        succeeded: false,
        error: {
          code: "PROFILE_UPDATE_RETRY_LIMIT",
          message: "Profile update exceeded the retry limit.",
        } satisfies DatabaseError,
      };
    };

    const newResult = await updateProfile("id", newPayload);
    const oldResult = newResult.succeeded
      ? null
      : await updateProfile("user_id", oldPayload);

    const insertProfile = async () => {
      const initialPayload: Record<string, unknown> = {
        id: user.id,
        user_id: user.id,
        ...newPayload,
        height: Number(form.height),
        current_weight: Number(form.currentWeight),
        goal_weight: Number(form.goalWeight),
      };
      const payload = { ...initialPayload };

      for (
        let attempt = 0;
        attempt < Object.keys(initialPayload).length + 1;
        attempt += 1
      ) {
        const result = await supabase
          .from("profiles")
          .insert(payload)
          .select("id")
          .maybeSingle();

        if (!result.error && result.data) {
          return { succeeded: true, error: null as DatabaseError | null };
        }

        const missingColumn = getMissingColumn(result.error);
        if (missingColumn && missingColumn in payload) {
          delete payload[missingColumn];
          continue;
        }

        return { succeeded: false, error: result.error as DatabaseError };
      }

      return {
        succeeded: false,
        error: {
          code: "PROFILE_INSERT_RETRY_LIMIT",
          message: "Profile insert exceeded the retry limit.",
        } satisfies DatabaseError,
      };
    };

    const insertResult =
      !newResult.succeeded &&
      !oldResult?.succeeded &&
      newResult.error?.code === "PROFILE_NOT_FOUND"
        ? await insertProfile()
        : null;

    if (
      !newResult.succeeded &&
      !oldResult?.succeeded &&
      !insertResult?.succeeded
    ) {
      const databaseError = insertResult?.error ?? oldResult?.error ?? newResult.error;
      const friendlyMessage = getUserFacingError(
        databaseError,
        "保存できませんでした。少し時間をおいてもう一度お試しください。"
      );
      const detail = databaseError?.code
        ? `（エラーコード: ${databaseError.code}）`
        : "";
      setError(`${friendlyMessage}${detail}`);
      setLoading(false);
      return;
    }

    window.localStorage.setItem("fastingAvatarPath", form.avatarPath);
    window.localStorage.setItem(localBirthDateKey, form.birthDate);
    const recordResult = await saveWeightRecord({
      supabase,
      userId: user.id,
      recordedDate: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0],
      weight: Number(form.currentWeight),
      bodyFat: form.bodyFat ? Number(form.bodyFat) : null,
    });
    if (!recordResult.succeeded) {
      console.warn(
        "Initial weight record could not be saved after profile setup.",
        recordResult.newError ?? recordResult.oldError
      );
    }
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-8 text-slate-950">
      <main className="mx-auto max-w-[430px]">
        <header className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
            <span className="text-3xl">🌿</span>
          </div>
          <h1 className="text-3xl font-bold">プロフィール登録</h1>
          <p className="mt-3 text-base text-stone-400">記録に使う基本情報を入れてください</p>
        </header>

        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((label, index) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${index === step ? "bg-[#5f9f9b] text-white" : index < step ? "bg-teal-100 text-teal-700" : "bg-white text-stone-400"}`}>
                {index + 1}
              </div>
              {index < STEPS.length - 1 && <div className="h-px w-8 bg-stone-200" />}
            </div>
          ))}
        </div>

        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">{STEPS[step]}</h2>

          {step === 0 && (
            <div className="mt-6 space-y-5">
              <Field label="ニックネーム" required>
                <input value={form.nickname} onChange={(event) => set("nickname", event.target.value)} className={inputClass} placeholder="例：さくら" maxLength={20} />
              </Field>
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
              <Field label="生年月日" required>
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, birthDate: event.target.value, age: calculateAge(event.target.value) }))}
                  className={inputClass}
                />
              </Field>
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
              <Field label="睡眠時間（時間/日）">
                <input type="number" value={form.sleepHours} onChange={(event) => set("sleepHours", event.target.value)} className={inputClass} placeholder="例：7" min={0} max={24} step={0.5} />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="mt-6 space-y-5">
              <Field label="身長 cm" required>
                <input ref={heightInputRef} type="number" value={form.height} onChange={(event) => set("height", event.target.value)} className={inputClass} placeholder="例：158.5" step={0.1} />
              </Field>
              <Field label="現在体重 kg" required>
                <input type="number" value={form.currentWeight} onChange={(event) => set("currentWeight", event.target.value)} className={inputClass} placeholder="例：56.8" step={0.1} />
              </Field>
              <Field label="体脂肪率 %">
                <input type="number" value={form.bodyFat} onChange={(event) => set("bodyFat", event.target.value)} className={inputClass} placeholder="例：25.5" step={0.1} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="筋肉量 kg">
                  <input type="number" value={form.muscleMass} onChange={(event) => set("muscleMass", event.target.value)} className={inputClass} placeholder="例：35.0" step={0.1} />
                </Field>
                <Field label="ウエスト cm">
                  <input type="number" value={form.waist} onChange={(event) => set("waist", event.target.value)} className={inputClass} placeholder="例：68" step={0.1} />
                </Field>
              </div>
              {form.gender === "female" && (
                <Field label="生理周期（日）">
                  <input type="number" value={form.menstrualCycle} onChange={(event) => set("menstrualCycle", event.target.value)} className={inputClass} placeholder="例：28" min={14} max={90} />
                </Field>
              )}
              {currentBMI && <BmiCard title="現在BMI" value={currentBMI} />}
            </div>
          )}

          {step === 2 && (
            <div className="mt-6 space-y-5">
              <Field label="目標体重 kg" required>
                <input ref={goalWeightInputRef} type="number" value={form.goalWeight} onChange={(event) => set("goalWeight", event.target.value)} className={inputClass} placeholder="例：50.0" step={0.1} />
              </Field>
              {minimumGoalWeight !== null && (
                <p className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-500">
                  現在の身長では、BMI 18.5を下回らない目標体重は
                  <span className="font-bold text-[#4d8b8a]"> {minimumGoalWeight.toFixed(1)}kg以上</span>
                  です。
                </p>
              )}
              {currentBMI && <BmiCard title="現在BMI" value={currentBMI} />}
              {goalBMI && <BmiCard title="目標BMI" value={goalBMI} />}
            </div>
          )}

          {error && <p className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

          <div className="mt-7 flex gap-3">
            {step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="flex-1 rounded-2xl border border-stone-200 py-4 font-bold text-stone-500">戻る</button>}
            <button type="button" onClick={step < STEPS.length - 1 ? handleNext : handleSubmit} disabled={loading} className="flex-1 rounded-2xl bg-[#5f9f9b] py-4 font-bold text-white disabled:opacity-60">
              {loading ? "保存中..." : step < STEPS.length - 1 ? "次へ" : "はじめる"}
            </button>
          </div>
        </section>
      </main>
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

function BmiCard({ title, value }: { title: string; value: number }) {
  const category = getBMICategory(value);
  return (
    <div className={`rounded-2xl p-4 ${category.bgColor}`}>
      <p className="text-sm font-bold text-stone-500">{title}</p>
      <p className={`mt-1 text-3xl font-bold ${category.color}`}>
        {value.toFixed(1)} <span className="text-base">{category.label}</span>
      </p>
    </div>
  );
}
