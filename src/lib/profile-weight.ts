const positiveNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export const getProfileCurrentWeight = (
  profile: Record<string, unknown> | null | undefined
) =>
  positiveNumber(profile?.current_weight_kg) ??
  positiveNumber(profile?.current_weight) ??
  positiveNumber(profile?.start_weight_kg) ??
  positiveNumber(profile?.start_weight);

export const hasProfileCurrentWeight = (
  profile: Record<string, unknown> | null | undefined
) =>
  positiveNumber(profile?.current_weight_kg) !== null ||
  positiveNumber(profile?.current_weight) !== null;
