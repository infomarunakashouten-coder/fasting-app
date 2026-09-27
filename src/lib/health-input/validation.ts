import { resolveHealthDate } from "./date";
import {
  healthParseResponseSchema,
  type HealthEntry,
  type HealthIssueCode,
  type ModelHealthParse,
} from "./schema";

export const HEALTH_VALUE_LIMITS = {
  weight: { min: 20, max: 500, unit: "kg" },
  body_fat: { min: 0, max: 100, unit: "%" },
} as const;

export function validateAndNormalizeHealthParse(
  parsed: ModelHealthParse,
  referenceDate: string,
  sourceText = "",
) {
  const entries = parsed.entries.map((entry): HealthEntry => {
    const issues: HealthIssueCode[] = [];
    const rawDateResolution = resolveHealthDate(entry.date_expression, referenceDate);
    const dateResolution = isDateExpressionGrounded(entry.date_expression, sourceText)
      ? rawDateResolution
      : { status: "ambiguous" as const, date: null };

    if (dateResolution.status === "ambiguous") issues.push("ambiguous_date");
    if (dateResolution.status === "invalid") issues.push("invalid_date");

    if (entry.type === "period_start") {
      if (entry.value !== null || entry.unit !== null) {
        issues.push("invalid_entry_shape");
      }
      return {
        type: entry.type,
        occurredOn: dateResolution.date,
        value: null,
        unit: null,
        needsConfirmation: issues.length > 0,
        issues,
      };
    }

    const limits = HEALTH_VALUE_LIMITS[entry.type];
    if (entry.value === null) {
      issues.push("missing_value");
    } else if (entry.value < limits.min || entry.value > limits.max) {
      issues.push("out_of_range");
    }
    if (entry.unit !== limits.unit) {
      issues.push("invalid_unit");
    }

    return {
      type: entry.type,
      occurredOn: dateResolution.date,
      value: entry.value,
      unit: limits.unit,
      needsConfirmation: issues.length > 0,
      issues,
    };
  });

  return healthParseResponseSchema.parse({
    entries,
    hasUnsupportedContent: parsed.has_unsupported_content,
    referenceDate,
    timezone: "Asia/Tokyo",
  });
}

function isDateExpressionGrounded(expression: string | null, sourceText: string) {
  const source = sourceText.replace(/\s+/g, "");
  const normalized = expression?.trim().replace(/\s+/g, "") ?? "";
  const sourceHasDateClue =
    /(今日|昨日|一昨日|明日|明後日|先週|今週|先月|今月|(?:\d{4}年)?\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2})/.test(
      source,
    );

  if (!normalized) return !sourceHasDateClue;
  if (["今日", "昨日", "一昨日"].includes(normalized)) return source.includes(normalized);
  if (source.includes(normalized)) return true;

  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return source.includes(`${isoMatch[1]}年${Number(isoMatch[2])}月${Number(isoMatch[3])}日`);
  }
  const japaneseMatch = normalized.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (japaneseMatch) {
    const iso = `${japaneseMatch[1]}-${japaneseMatch[2].padStart(2, "0")}-${japaneseMatch[3].padStart(2, "0")}`;
    return source.includes(iso);
  }
  return false;
}

export function validateEditableHealthEntry(entry: HealthEntry): HealthEntry {
  const issues: HealthIssueCode[] = [];
  if (!entry.occurredOn) issues.push("ambiguous_date");

  if (entry.type === "period_start") {
    return {
      ...entry,
      value: null,
      unit: null,
      issues,
      needsConfirmation: issues.length > 0,
    };
  }

  const limits = HEALTH_VALUE_LIMITS[entry.type];
  if (entry.value === null) {
    issues.push("missing_value");
  } else if (entry.value < limits.min || entry.value > limits.max) {
    issues.push("out_of_range");
  }
  return {
    ...entry,
    unit: limits.unit,
    issues,
    needsConfirmation: issues.length > 0,
  };
}

export const HEALTH_ISSUE_MESSAGES: Record<HealthIssueCode, string> = {
  missing_value: "数値を入力してください。",
  invalid_unit: "単位を確認してください。",
  out_of_range: "入力ミスの可能性があるため、数値を確認してください。",
  ambiguous_date: "年を含む日付を指定してください。",
  invalid_date: "存在する日付を指定してください。",
  invalid_entry_shape: "解析結果の形式を確認してください。",
};
