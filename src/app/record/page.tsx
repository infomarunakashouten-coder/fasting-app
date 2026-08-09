"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Navigation from "@/components/Navigation";
import { mergeWeightRecordsByDate } from "@/lib/merge-weight-records";
import { createClient } from "@/lib/supabase";
import {
  getUserFacingError,
  isMissingDatabaseObjectError,
} from "@/lib/user-facing-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { saveWeightRecord } from "@/lib/weight-records";
import {
  buildChartTicks,
  buildRecordChartData,
  chartPeriodLabels,
  formatChartTick,
  formatTooltipDate,
  getPeriodRange,
  type ChartPeriod,
} from "@/lib/records-chart";
import type { DailyRecord } from "@/types";

type RecordRow = DailyRecord & Record<string, any>;
type Notice = { type: "success" | "error" | "info"; text: string } | null;

const periods: ChartPeriod[] = ["14", "30", "90", "365"];

const inputClass =
  "w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5d9997] focus:ring-2 focus:ring-teal-100";

const localDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
};

const displayDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

const numberValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const noticeClass = {
  success: "bg-teal-50 text-teal-700 border-teal-100",
  error: "bg-red-50 text-red-700 border-red-100",
  info: "bg-stone-50 text-stone-600 border-stone-100",
};

const profileWeightUpdate = (
  records: Array<Partial<RecordRow>>,
  clearMissing = false
) => {
  const latestWeight =
    records
      .map((record) => numberValue(record.weight_kg ?? record.weight))
      .find((value) => value !== null) ?? null;
  const latestBodyFat =
    records
      .map((record) => numberValue(record.body_fat_percentage))
      .find((value) => value !== null) ?? null;
  const update: Record<string, number | null> = {};

  if (latestWeight !== null) {
    update.current_weight_kg = latestWeight;
    update.current_weight = latestWeight;
  } else if (clearMissing) {
    update.current_weight_kg = null;
    update.current_weight = null;
  }
  if (latestBodyFat !== null) {
    update.body_fat_percentage = latestBodyFat;
  } else if (clearMissing) {
    update.body_fat_percentage = null;
  }

  return update;
};

export default function RecordPage() {
  const router = useRouter();
  const supabase = createClient();
  const today = localDateString();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [memo, setMemo] = useState("");
  const [recentRecords, setRecentRecords] = useState<RecordRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("14");
  const savedForm = useRef("");

  const formSnapshot = JSON.stringify({ date, weight, bodyFat, memo, editingId });
  useUnsavedChanges(!loading && !saving && savedForm.current !== "" && formSnapshot !== savedForm.current);

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRecordToForm = (record: RecordRow) => {
    const nextForm = {
      date: record.recorded_date,
      weight: (record.weight_kg ?? record.weight ?? "").toString(),
      bodyFat: (record.body_fat_percentage ?? "").toString(),
      memo: record.memo ?? "",
      editingId: record.id,
    };
    setDate(nextForm.date);
    setWeight(nextForm.weight);
    setBodyFat(nextForm.bodyFat);
    setMemo(nextForm.memo);
    setEditingId(nextForm.editingId);
    savedForm.current = JSON.stringify(nextForm);
  };

  const resetForm = () => {
    setDate(today);
    setWeight("");
    setBodyFat("");
    setMemo("");
    setEditingId(null);
    setNotice(null);
    savedForm.current = JSON.stringify({
      date: today,
      weight: "",
      bodyFat: "",
      memo: "",
      editingId: null,
    });
  };

  const loadRecords = async (formDate = today) => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const [{ data: newRecords, error: newError }, { data: oldRecords, error: oldError }] = await Promise.all([
      supabase.from("daily_records").select("*").eq("user_id", user.id).order("recorded_date", { ascending: false }).limit(400),
      supabase.from("weight_records").select("*").eq("user_id", user.id).order("recorded_date", { ascending: false }).limit(400),
    ]);

    if (newError && oldError) {
      setNotice({ type: "error", text: "記録の読み込みに失敗しました。時間をおいて再読み込みしてください。" });
      setLoading(false);
      return;
    }

    setNotice(null);
    const records = mergeWeightRecordsByDate(newRecords ?? [], oldRecords ?? []);
    setRecentRecords(records);

    const formRecord = records.find((record) => record.recorded_date === formDate);
    if (formRecord) {
      applyRecordToForm(formRecord);
    } else {
      savedForm.current = JSON.stringify({
        date: formDate,
        weight: "",
        bodyFat: "",
        memo: "",
        editingId: null,
      });
    }

    setLoading(false);
  };

  const handleSave = async () => {
    if (!weight && !bodyFat) {
      setNotice({ type: "info", text: "体重または体脂肪率を入力してください。" });
      return;
    }

    const weightNumber = weight ? Number(weight) : null;
    const bodyFatNumber = bodyFat ? Number(bodyFat) : null;

    if (weightNumber !== null && (!Number.isFinite(weightNumber) || weightNumber <= 0 || weightNumber > 500)) {
      setNotice({ type: "error", text: "体重の数値を確認してください。" });
      return;
    }
    if (bodyFatNumber !== null && (!Number.isFinite(bodyFatNumber) || bodyFatNumber < 0 || bodyFatNumber > 100)) {
      setNotice({ type: "error", text: "体脂肪率は0から100の範囲で入力してください。" });
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

    const result = await saveWeightRecord({
      supabase,
      userId: user.id,
      recordedDate: date,
      weight: weightNumber,
      bodyFat: bodyFatNumber,
      memo,
      preserveExistingValues: !editingId,
    });

    if (!result.succeeded) {
      setSaving(false);
      setNotice({
        type: "error",
        text: "保存に失敗しました。通信状況を確認して、もう一度お試しください。",
      });
      return;
    }

    const recordsAfterSave = [
      {
        id: editingId ?? `pending-${date}`,
        recorded_date: date,
        weight_kg: result.weight,
        weight: result.weight,
        body_fat_percentage: result.bodyFat,
      },
      ...recentRecords.filter((record) => record.recorded_date !== date),
    ].sort((a, b) => b.recorded_date.localeCompare(a.recorded_date));
    const update = profileWeightUpdate(recordsAfterSave);
    if (Object.keys(update).length > 0) {
      await Promise.all([
        supabase.from("profiles").update(update).eq("id", user.id),
        supabase.from("profiles").update(update).eq("user_id", user.id),
      ]);
    }

    await loadRecords(date);
    // The reload replaces a temporary id with the persisted row id. Until that
    // completes, keep navigation guards disabled so the transient form state is
    // never mistaken for an unsaved edit.
    setNotice({ type: "success", text: "記録を保存しました。" });
    setSaving(false);
  };

  const handleDelete = async (record: RecordRow) => {
    if (!confirm(`${displayDate(record.recorded_date)} の記録を削除しますか？`)) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const [{ error: newError }, { error: oldError }] = await Promise.all([
      supabase
        .from("daily_records")
        .delete()
        .eq("user_id", user.id)
        .eq("recorded_date", record.recorded_date),
      supabase
        .from("weight_records")
        .delete()
        .eq("user_id", user.id)
        .eq("recorded_date", record.recorded_date),
    ]);

    const blockingError = [newError, oldError].find(
      (error) => error && !isMissingDatabaseObjectError(error)
    );
    if (blockingError) {
      setNotice({
        type: "error",
        text: getUserFacingError(
          blockingError,
          "削除を完了できませんでした。再読み込みして、もう一度お試しください。"
        ),
      });
      return;
    }

    if (editingId === record.id) resetForm();
    const removedWeight = numberValue(record.weight_kg ?? record.weight);
    const removedBodyFat = numberValue(record.body_fat_percentage);
    if (removedWeight !== null || removedBodyFat !== null) {
      const remainingRecords = recentRecords.filter(
        (item) => item.recorded_date !== record.recorded_date
      );
      const update = profileWeightUpdate(remainingRecords, true);
      await Promise.all([
        supabase.from("profiles").update(update).eq("id", user.id),
        supabase.from("profiles").update(update).eq("user_id", user.id),
      ]);
    }
    setNotice({ type: "success", text: "記録を削除しました。" });
    loadRecords();
  };

  const chartData = useMemo(() => buildRecordChartData(recentRecords, chartPeriod), [recentRecords, chartPeriod]);
  const chartTicks = useMemo(() => buildChartTicks(chartPeriod), [chartPeriod]);
  const chartRange = useMemo(() => getPeriodRange(chartPeriod), [chartPeriod]);
  const chartWeightCount = chartData.filter((point) => point.weight !== null).length;
  const chartBodyFatCount = chartData.filter((point) => point.bodyFat !== null).length;
  const hasChartSeries = chartWeightCount >= 2 || chartBodyFatCount >= 2;

  const weightRecords = recentRecords.filter(
    (record) => numberValue(record.weight_kg ?? record.weight) !== null
  );
  const bodyFatRecords = recentRecords.filter(
    (record) => numberValue(record.body_fat_percentage) !== null
  );
  const latestWeightRecord = weightRecords[0] ?? null;
  const previousWeightRecord = weightRecords[1] ?? null;
  const latestBodyFatRecord = bodyFatRecords[0] ?? null;
  const latestWeight = numberValue(
    latestWeightRecord?.weight_kg ?? latestWeightRecord?.weight
  );
  const previousWeight = numberValue(
    previousWeightRecord?.weight_kg ?? previousWeightRecord?.weight
  );
  const latestBodyFat = numberValue(latestBodyFatRecord?.body_fat_percentage);
  const weightDiff = latestWeight !== null && previousWeight !== null ? latestWeight - previousWeight : null;

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <h1 className="text-3xl font-bold tracking-normal">体重</h1>
          <p className="mt-2 text-base text-stone-400">体重・体脂肪率の入力履歴</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          <section className="rounded-[22px] bg-[#5d9997] p-5 text-white shadow-sm">
            <p className="text-sm font-bold text-white/70">直近の測定値</p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Metric
                label="体重"
                value={latestWeight === null ? "--" : latestWeight.toFixed(1)}
                unit="kg"
                date={latestWeightRecord?.recorded_date}
              />
              <Metric
                label="体脂肪率"
                value={latestBodyFat === null ? "--" : latestBodyFat.toFixed(1)}
                unit="%"
                date={latestBodyFatRecord?.recorded_date}
              />
            </div>
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/15 px-4 py-3">
              <span className="text-sm font-bold text-white/75">前回から</span>
              <span className="text-lg font-bold">
                {weightDiff === null ? "--" : `${weightDiff >= 0 ? "+" : ""}${weightDiff.toFixed(1)} kg`}
              </span>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{editingId ? "記録を編集" : "今日の記録を追加"}</h2>
                <p className="text-sm text-stone-400">日付を変えて過去の記録も入力できます</p>
              </div>
              {editingId && (
                <button onClick={resetForm} className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-500">
                  新規
                </button>
              )}
            </div>

            <div className="space-y-4">
              <Field label="日付">
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} max={today} className={inputClass} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="体重 kg">
                  <input type="number" value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" step="0.1" placeholder="54.5" className={`${inputClass} text-xl font-bold`} />
                </Field>
                <Field label="体脂肪率 %">
                  <input type="number" value={bodyFat} onChange={(event) => setBodyFat(event.target.value)} inputMode="decimal" step="0.1" placeholder="24.5" className={`${inputClass} text-xl font-bold`} />
                </Field>
              </div>
              {editingId && (
                <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500">
                  編集中に体重または体脂肪率を空欄で保存すると、その項目の記録を削除します。
                </p>
              )}

              <Field label="メモ">
                <textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} maxLength={200} placeholder="今日の調子、食事内容など..." className={`${inputClass} resize-none`} />
              </Field>
            </div>

            {notice && <p className={`mt-3 rounded-xl border px-3 py-2 text-sm ${noticeClass[notice.type]}`}>{notice.text}</p>}

            <button onClick={handleSave} disabled={saving} className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white shadow-sm disabled:opacity-60">
              {saving ? "保存中..." : "保存する"}
            </button>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">{chartPeriodLabels[chartPeriod]}の推移</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold sm:text-xs">
                <span className="text-[#5d9997]">左：体重</span>
                <span className="text-[#c9a35b]">右：体脂肪率</span>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-4 gap-2 rounded-2xl bg-stone-100 p-1">
              {periods.map((period) => (
                <button key={period} onClick={() => setChartPeriod(period)} className={`rounded-xl py-2 text-[11px] font-bold transition ${chartPeriod === period ? "bg-white text-[#4d8b8a] shadow-sm" : "text-stone-500"}`}>
                  {chartPeriodLabels[period]}
                </button>
              ))}
            </div>
            {!hasChartSeries ? (
              <EmptyState title="まだグラフを表示できません" description="体重または体脂肪率を2日以上記録すると、推移が見えるようになります。" />
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                  <XAxis dataKey="x" type="number" domain={[chartRange.startTime, chartRange.endTime]} ticks={chartTicks} tickFormatter={(value) => formatChartTick(Number(value), chartPeriod)} tick={{ fontSize: 12, fill: "#a8a29e" }} tickLine={false} interval={0} />
                  <YAxis
                    yAxisId="weight"
                    orientation="left"
                    width={52}
                    tickMargin={4}
                    tick={{ fontSize: 11, fill: "#5d9997" }}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickFormatter={(value) => `${value}kg`}
                  />
                  <YAxis
                    yAxisId="bodyFat"
                    orientation="right"
                    width={48}
                    tickMargin={4}
                    tick={{ fontSize: 11, fill: "#c9a35b" }}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip labelFormatter={(value) => formatTooltipDate(Number(value), chartPeriod)} formatter={(value, name) => [`${value}${name === "体重" ? "kg" : "%"}`, name]} />
                  {chartWeightCount >= 2 && (
                    <Line yAxisId="weight" type="monotone" dataKey="weight" stroke="#5d9997" strokeWidth={4} dot={false} name="体重" connectNulls={false} />
                  )}
                  {chartBodyFatCount >= 2 && (
                    <Line yAxisId="bodyFat" type="monotone" dataKey="bodyFat" stroke="#c9a35b" strokeWidth={4} dot={false} name="体脂肪率" connectNulls={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <h2 className="text-lg font-bold">履歴</h2>
            {loading ? (
              <EmptyState title="読み込み中..." description="記録を確認しています。" />
            ) : recentRecords.length === 0 ? (
              <EmptyState title="まだ記録がありません" description="最初の体重または体脂肪率を保存すると、ここに履歴が表示されます。" />
            ) : (
              <div className="mt-3 divide-y divide-stone-100">
                {recentRecords.map((record) => {
                  const recordWeight = numberValue(record.weight_kg ?? record.weight);
                  const recordBodyFat = numberValue(record.body_fat_percentage);

                  return (
                    <div key={record.id} className="flex items-center gap-3 py-3">
                      <button onClick={() => { applyRecordToForm(record); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="min-w-0 flex-1 text-left">
                        <p className="text-sm font-bold text-slate-700">{displayDate(record.recorded_date)}</p>
                        {record.memo && <p className="mt-1 truncate text-xs text-stone-400">{record.memo}</p>}
                      </button>
                      <div className="text-right">
                        <p className="text-base font-bold text-[#4d8b8a]">{recordWeight === null ? "--" : recordWeight.toFixed(1)}<span className="text-xs text-stone-400">kg</span></p>
                        <p className="text-xs font-bold text-[#c9a35b]">{recordBodyFat === null ? "--" : recordBodyFat.toFixed(1)}<span className="text-stone-400">%</span></p>
                      </div>
                      <button onClick={() => handleDelete(record)} className="rounded-full px-2 py-1 text-sm text-stone-300 hover:bg-rose-50 hover:text-rose-500" aria-label="記録を削除">
                        削除
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      <Navigation active="record" />
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

function Metric({
  label,
  value,
  unit,
  date,
}: {
  label: string;
  value: string;
  unit: string;
  date?: string;
}) {
  return (
    <div>
      <p className="text-sm text-white/70">{label}</p>
      <p className="mt-1 text-4xl font-light">
        {value}
        <span className="ml-1 text-base font-bold text-white/70">{unit}</span>
      </p>
      <p className="mt-1 min-h-5 text-xs font-bold text-white/60">
        {date ? displayDate(date) : "記録なし"}
      </p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-36 place-items-center rounded-2xl bg-stone-50 px-5 py-8 text-center">
      <div>
        <p className="text-base font-bold text-stone-500">{title}</p>
        <p className="mt-2 text-sm leading-6 text-stone-400">{description}</p>
      </div>
    </div>
  );
}
