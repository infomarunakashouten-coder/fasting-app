import type { SupabaseClient } from "@supabase/supabase-js";

type MeasurementRow = {
  recorded_date: string;
  weight?: number | string | null;
  body_fat_percentage?: number | string | null;
};

export type LatestMeasurement = { value: number; recordedDate: string };
export type LatestMeasurements = {
  weight: LatestMeasurement | null;
  previousWeight: LatestMeasurement | null;
  bodyFat: LatestMeasurement | null;
};

export const emptyLatestMeasurements: LatestMeasurements = {
  weight: null,
  previousWeight: null,
  bodyFat: null,
};

export function measurementNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getLatestMeasurements(rows: MeasurementRow[]): LatestMeasurements {
  const sorted = [...rows].sort((a, b) => b.recorded_date.localeCompare(a.recorded_date));
  const values = (metric: "weight" | "body_fat_percentage") =>
    sorted.flatMap((row) => {
      const value = measurementNumber(row[metric]);
      return value === null ? [] : [{ value, recordedDate: row.recorded_date }];
    });
  const weights = values("weight");
  return {
    weight: weights[0] ?? null,
    previousWeight: weights[1] ?? null,
    bodyFat: values("body_fat_percentage")[0] ?? null,
  };
}

/** Canonical read only. Filter in the DB BEFORE LIMIT; independent of history limits. */
export async function loadLatestMeasurements(supabase: SupabaseClient, userId: string) {
  const [weight, bodyFat] = await Promise.all([
    supabase.from("weight_records").select("recorded_date,weight")
      .eq("user_id", userId).not("weight", "is", null)
      .order("recorded_date", { ascending: false }).limit(2),
    supabase.from("weight_records").select("recorded_date,body_fat_percentage")
      .eq("user_id", userId).not("body_fat_percentage", "is", null)
      .order("recorded_date", { ascending: false }).limit(1),
  ]);
  // Do not misrepresent permission/network failures as missing measurements.
  const error = weight.error ?? bodyFat.error;
  return {
    ...getLatestMeasurements([...(weight.data ?? []), ...(bodyFat.data ?? [])]),
    error,
  };
}
