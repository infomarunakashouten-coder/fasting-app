export type Gender = "female" | "male" | "other";
export type PlanType = "free" | "ai_fasting";
export type FastingDuration = 3 | 5 | 7;
export type FastingPhase = "準備期" | "本番期" | "回復期";
export type MealCheckType = "通常食" | "準備食" | "回復食";

export type FastingType =
  | "sweet"
  | "fat_salt"
  | "overeating"
  | "grazing"
  | "late_night"
  | "stress"
  | "self_managed";

export interface Profile {
  id: string;
  nickname: string | null;
  age: number | null;
  birth_date?: string | null;
  gender: Gender | null;
  height_cm: number | null;
  current_weight_kg: number | null;
  goal_weight_kg: number | null;
  body_fat_percentage: number | null;
  muscle_mass_kg: number | null;
  waist_cm: number | null;
  menstrual_cycle_days: number | null;
  sleep_hours: number | null;
  start_weight_kg: number | null;
  notifications_enabled: boolean | null;
  plan_type: PlanType | null;
  ai_checks_remaining: number | null;
  ai_checks_used_month: number | null;
  ai_checks_reset_on: string | null;
  is_admin?: boolean | null;
  is_profile_complete: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailyRecord {
  id: string;
  user_id: string;
  recorded_date: string;
  weight_kg: number | null;
  body_fat_percentage: number | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiagnosisResult {
  id: string;
  user_id: string;
  fasting_type: FastingType;
  answers: Record<string, string> | null;
  created_at: string;
}

export interface FastingPlan {
  id: string;
  user_id: string;
  start_date: string;
  duration_days: FastingDuration;
  main_drink: string;
  notifications_enabled: boolean;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface FastingRecord {
  id: string;
  user_id: string;
  plan_id: string | null;
  recorded_date: string;
  phase: string | null;
  weight_kg: number | null;
  body_fat_percentage: number | null;
  water_liters: number | null;
  hunger_level: number | null;
  condition: string | null;
  sleep_hours: number | null;
  bowel_movement: string | null;
  swelling: "none" | "slight" | "bad" | null;
  discomfort: string | null;
  meal_photo_url: string | null;
  ai_checked: boolean;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunityPost {
  id: string;
  user_id: string;
  category: string;
  body: string;
  is_anonymous: boolean;
  is_hidden?: boolean;
  needs_review?: boolean;
  likes_count: number;
  reports_count: number;
  created_at: string;
}

export interface MealCheck {
  id: string;
  user_id: string;
  check_type: MealCheckType;
  photo_url: string | null;
  ai_comment: string | null;
  created_at: string;
}

export interface BMIInfo {
  bmi: number;
  category: string;
  color: string;
}

export const BMI_CATEGORIES = [
  { max: 18.5, label: "低体重", color: "text-blue-500" },
  { max: 25, label: "標準", color: "text-green-500" },
  { max: 30, label: "肥満1度", color: "text-yellow-500" },
  { max: 35, label: "肥満2度", color: "text-orange-500" },
  { max: 40, label: "肥満3度", color: "text-red-500" },
  { max: Infinity, label: "肥満4度", color: "text-red-700" },
] as const;

export const PLAN_INFO: Record<PlanType, { label: string; price: string; description: string }> = {
  free: {
    label: "体重管理プラン",
    price: "0円",
    description: "体重・体脂肪率を記録し、変化を見える化します。",
  },
  ai_fasting: {
    label: "本格ファスティングAIプラン",
    price: "月額1,980円",
    description: "毎日の食事AIチェックとファスティングの準備・本番・回復を支援します。",
  },
};

export const FASTING_PHASES: Record<FastingDuration, string[]> = {
  3: ["準備期", "本番期", "回復期"],
  5: ["準備期", "本番期", "本番期", "回復期", "回復期"],
  7: ["準備期", "準備期", "本番期", "本番期", "回復期", "回復期", "回復期"],
};

export const FASTING_TYPE_INFO: Record<
  FastingType,
  { label: string; emoji: string; description: string; advice: string }
> = {
  sweet: {
    label: "甘いもの欲タイプ",
    emoji: "🍰",
    description: "食後や間食で甘いものが欲しくなりやすいタイプです。",
    advice: "たんぱく質と食物繊維を意識して、甘いものは時間と量を決めると続けやすくなります。",
  },
  fat_salt: {
    label: "脂・塩タイプ",
    emoji: "🍟",
    description: "濃い味、揚げ物、しょっぱいものに引っぱられやすいタイプです。",
    advice: "汁物や香味野菜を使って満足感を作り、塩分と脂質を少しずつ整えていきましょう。",
  },
  overeating: {
    label: "大食いタイプ",
    emoji: "🍚",
    description: "満腹になるまで食べやすく、量の調整が課題になりやすいタイプです。",
    advice: "最初に汁物や野菜を入れて、よく噛む習慣を作ると食べすぎを防ぎやすくなります。",
  },
  grazing: {
    label: "ダラダラ食べタイプ",
    emoji: "🍪",
    description: "食事時間が曖昧で、少しずつ食べ続けやすいタイプです。",
    advice: "食べる時間と食べない時間を分けるだけで、ファスティングの土台が作りやすくなります。",
  },
  late_night: {
    label: "夜食タイプ",
    emoji: "🌙",
    description: "夜遅くの食事や間食が習慣になりやすいタイプです。",
    advice: "夕食を軽く整えつつ、夜に空腹になりすぎないリズムを作るところから始めましょう。",
  },
  stress: {
    label: "ストレス食いタイプ",
    emoji: "☕",
    description: "疲れやストレスを食べることで落ち着かせやすいタイプです。",
    advice: "食べる以外の休み方を用意しておくと、気持ちの波に振り回されにくくなります。",
  },
  self_managed: {
    label: "自己管理型",
    emoji: "📝",
    description: "食生活を比較的コントロールできていて、記録との相性がよいタイプです。",
    advice: "今の良い習慣を保ちながら、無理のない範囲でファスティング計画を試してみましょう。",
  },
};
