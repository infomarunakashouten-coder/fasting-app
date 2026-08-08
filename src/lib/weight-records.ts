type SupabaseClientLike = any;

type SaveWeightRecordInput = {
  supabase: SupabaseClientLike;
  userId: string;
  recordedDate: string;
  weight: number | null;
  bodyFat: number | null;
  memo?: string | null;
  preserveExistingValues?: boolean;
};

type SaveWeightRecordResult = {
  weight: number | null;
  bodyFat: number | null;
  newError: any | null;
  oldError: any | null;
  succeeded: boolean;
};

export async function saveWeightRecord({
  supabase,
  userId,
  recordedDate,
  weight,
  bodyFat,
  memo,
  preserveExistingValues = true,
}: SaveWeightRecordInput): Promise<SaveWeightRecordResult> {
  const [{ data: existingNewRecord }, { data: existingOldRecord }] = await Promise.all([
    supabase
      .from("daily_records")
      .select("weight_kg, body_fat_percentage")
      .eq("user_id", userId)
      .eq("recorded_date", recordedDate)
      .maybeSingle(),
    supabase
      .from("weight_records")
      .select("weight, body_fat_percentage")
      .eq("user_id", userId)
      .eq("recorded_date", recordedDate)
      .maybeSingle(),
  ]);

  const savedWeight = existingNewRecord?.weight_kg ?? existingOldRecord?.weight ?? null;
  const savedBodyFat = existingNewRecord?.body_fat_percentage ?? existingOldRecord?.body_fat_percentage ?? null;
  const nextWeight = preserveExistingValues ? weight ?? savedWeight : weight;
  const nextBodyFat = preserveExistingValues ? bodyFat ?? savedBodyFat : bodyFat;

  const newPayload = {
    user_id: userId,
    recorded_date: recordedDate,
    weight_kg: nextWeight,
    body_fat_percentage: nextBodyFat,
    ...(memo !== undefined ? { memo: memo || null } : {}),
  };
  const oldPayload = {
    user_id: userId,
    recorded_date: recordedDate,
    weight: nextWeight,
    body_fat_percentage: nextBodyFat,
  };

  const saveNewRecord = async () => {
    const upsert = await supabase.from("daily_records").upsert(newPayload, { onConflict: "user_id,recorded_date" });
    if (!upsert.error) return null;

    const updatePayload =
      memo !== undefined
        ? { weight_kg: nextWeight, body_fat_percentage: nextBodyFat, memo: memo || null }
        : { weight_kg: nextWeight, body_fat_percentage: nextBodyFat };
    const update = await supabase
      .from("daily_records")
      .update(updatePayload)
      .eq("user_id", userId)
      .eq("recorded_date", recordedDate)
      .select("id")
      .maybeSingle();
    if (!update.error && update.data) return null;

    const insert = await supabase.from("daily_records").insert(newPayload);
    return insert.error ?? update.error ?? upsert.error;
  };

  const saveOldRecord = async () => {
    const upsert = await supabase.from("weight_records").upsert(oldPayload, { onConflict: "user_id,recorded_date" });
    if (!upsert.error) return null;

    const update = await supabase
      .from("weight_records")
      .update({
        weight: nextWeight,
        body_fat_percentage: nextBodyFat,
      })
      .eq("user_id", userId)
      .eq("recorded_date", recordedDate)
      .select("id")
      .maybeSingle();
    if (!update.error && update.data) return null;

    const insert = await supabase.from("weight_records").insert(oldPayload);
    return insert.error ?? update.error ?? upsert.error;
  };

  const [newError, oldError] = await Promise.all([saveNewRecord(), saveOldRecord()]);
  const succeeded = !newError || !oldError;

  return {
    weight: nextWeight,
    bodyFat: nextBodyFat,
    newError,
    oldError,
    succeeded,
  };
}

export function buildProfileWeightUpdate(weight: number | null, bodyFat: number | null) {
  const update: Record<string, number> = {};
  if (weight !== null) {
    update.current_weight_kg = weight;
    update.current_weight = weight;
  }
  if (bodyFat !== null) {
    update.body_fat_percentage = bodyFat;
  }
  return update;
}
