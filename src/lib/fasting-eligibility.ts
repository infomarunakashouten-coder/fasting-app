export const FASTING_MIN_BMI = 18.5;
export const FASTING_MIN_AGE = 18;

export function getMinimumWeightForBmi(heightCm: number, bmi = FASTING_MIN_BMI) {
  if (!Number.isFinite(heightCm) || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  return Math.ceil(bmi * heightM * heightM * 10) / 10;
}

type EligibilityInput = {
  bmi: number | null;
  age?: number | null;
  birthDate?: string | null;
};

export function calculateCurrentAge(birthDate?: string | null) {
  if (!birthDate) return null;
  const birthday = new Date(`${String(birthDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birthday.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDifference = today.getMonth() - birthday.getMonth();
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthday.getDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function getFastingEligibility({ bmi, age, birthDate }: EligibilityInput) {
  const currentAge = calculateCurrentAge(birthDate) ?? age;

  if (currentAge !== null && currentAge !== undefined && currentAge < FASTING_MIN_AGE) {
    return {
      eligible: false,
      reason: "本格ファスティングAIプランは18歳以上の方を対象としています。",
    };
  }

  if (bmi === null || !Number.isFinite(bmi)) {
    return {
      eligible: false,
      reason: "安全確認のため、身長と現在体重を登録してください。",
    };
  }

  if (bmi < FASTING_MIN_BMI) {
    return {
      eligible: false,
      reason: `現在のBMIは${bmi.toFixed(1)}です。BMI ${FASTING_MIN_BMI}未満の方は本格プランを利用できません。`,
    };
  }

  return { eligible: true, reason: "" };
}
