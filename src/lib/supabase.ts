import { createBrowserClient } from "@supabase/ssr";
import type {
  CommunityPost,
  DailyRecord,
  DiagnosisResult,
  FastingPlan,
  FastingRecord,
  MealCheck,
  Profile,
} from "@/types";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      daily_records: {
        Row: DailyRecord;
        Insert: Omit<DailyRecord, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DailyRecord, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      diagnosis_results: {
        Row: DiagnosisResult;
        Insert: Omit<DiagnosisResult, "id" | "created_at">;
        Update: never;
        Relationships: [];
      };
      fasting_plans: {
        Row: FastingPlan;
        Insert: Omit<FastingPlan, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<FastingPlan, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      fasting_records: {
        Row: FastingRecord;
        Insert: Omit<FastingRecord, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<FastingRecord, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      meal_checks: {
        Row: MealCheck;
        Insert: Omit<MealCheck, "id" | "created_at">;
        Update: never;
        Relationships: [];
      };
      community_posts: {
        Row: CommunityPost;
        Insert: Omit<CommunityPost, "id" | "likes_count" | "reports_count" | "created_at">;
        Update: Partial<Pick<CommunityPost, "body" | "category" | "is_anonymous" | "likes_count" | "reports_count">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export const AI_CHECK_MONTHLY_LIMIT = 93;
export const AI_CHECK_DAILY_LIMIT = 3;

export const createClient = () =>
  createBrowserClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

export function calcBMI(weightKg: number, heightCm: number): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || weightKg <= 0 || heightCm <= 0) {
    return 0;
  }
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

export function getTodayString() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().split("T")[0];
}

export function isPaidPlan(planType?: string | null) {
  return planType === "ai_fasting" || planType === "honkaku" || planType === "light";
}

export function getBMICategory(bmi: number): {
  label: string;
  color: string;
  bgColor: string;
} {
  if (bmi < 18.5) return { label: "低体重", color: "text-blue-600", bgColor: "bg-blue-50" };
  if (bmi < 25) return { label: "標準", color: "text-green-600", bgColor: "bg-green-50" };
  if (bmi < 30) return { label: "肥満1度", color: "text-yellow-600", bgColor: "bg-yellow-50" };
  if (bmi < 35) return { label: "肥満2度", color: "text-orange-600", bgColor: "bg-orange-50" };
  if (bmi < 40) return { label: "肥満3度", color: "text-red-600", bgColor: "bg-red-50" };
  return { label: "肥満4度", color: "text-red-800", bgColor: "bg-red-100" };
}
