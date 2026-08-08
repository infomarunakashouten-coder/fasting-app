import { FASTING_MIN_BMI, getMinimumWeightForBmi } from "@/lib/fasting-eligibility";

type ProfileValidationInput = {
  birthDate?: string;
  height?: string;
  currentWeight?: string;
  goalWeight?: string;
  startWeight?: string;
  bodyFat?: string;
  muscleMass?: string;
  waist?: string;
  menstrualCycle?: string;
  sleepHours?: string;
};

const toOptionalNumber = (value?: string) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
};

const inRange = (value: number | null, min: number, max: number) =>
  value === null || (Number.isFinite(value) && value >= min && value <= max);

export function validateProfileFields(input: ProfileValidationInput) {
  if (input.birthDate) {
    const birthDate = new Date(`${input.birthDate}T00:00:00`);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (Number.isNaN(birthDate.getTime()) || birthDate > today) {
      return "生年月日を確認してください。";
    }

    const age = today.getFullYear() - birthDate.getFullYear();
    if (age > 120) return "生年月日を確認してください。";
  }

  const height = toOptionalNumber(input.height);
  if (!inRange(height, 80, 250)) return "身長は80cmから250cmの範囲で入力してください。";

  const currentWeight = toOptionalNumber(input.currentWeight);
  if (!inRange(currentWeight, 20, 500)) return "現在体重は20kgから500kgの範囲で入力してください。";

  const goalWeight = toOptionalNumber(input.goalWeight);
  if (!inRange(goalWeight, 20, 500)) return "目標体重は20kgから500kgの範囲で入力してください。";
  if (height !== null && goalWeight !== null) {
    const minimumWeight = getMinimumWeightForBmi(height);
    if (minimumWeight !== null && goalWeight < minimumWeight) {
      return `目標BMIが${FASTING_MIN_BMI}未満になるため、目標体重は${minimumWeight.toFixed(1)}kg以上に設定してください。`;
    }
  }

  const startWeight = toOptionalNumber(input.startWeight);
  if (!inRange(startWeight, 20, 500)) return "開始体重は20kgから500kgの範囲で入力してください。";

  const bodyFat = toOptionalNumber(input.bodyFat);
  if (!inRange(bodyFat, 0, 100)) return "体脂肪率は0%から100%の範囲で入力してください。";

  const muscleMass = toOptionalNumber(input.muscleMass);
  if (!inRange(muscleMass, 0, 200)) return "筋肉量は0kgから200kgの範囲で入力してください。";

  const waist = toOptionalNumber(input.waist);
  if (!inRange(waist, 30, 250)) return "ウエストは30cmから250cmの範囲で入力してください。";

  const menstrualCycle = toOptionalNumber(input.menstrualCycle);
  if (menstrualCycle !== null && (!Number.isInteger(menstrualCycle) || menstrualCycle < 1 || menstrualCycle > 120)) {
    return "生理周期は1日から120日の整数で入力してください。";
  }

  const sleepHours = toOptionalNumber(input.sleepHours);
  if (!inRange(sleepHours, 0, 24)) return "睡眠時間は0時間から24時間の範囲で入力してください。";

  return null;
}
