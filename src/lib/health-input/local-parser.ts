import { getTokyoReference } from "./date";
import {
  MAX_HEALTH_TEXT_LENGTH,
  type HealthParseResponse,
  type ModelHealthParse,
} from "./schema";
import { validateAndNormalizeHealthParse } from "./validation";

export type LocalParseDecision =
  | "local_complete"
  | "needs_confirmation"
  | "needs_ai";

export type LocalHealthParseResult = {
  decision: LocalParseDecision;
  result: HealthParseResponse | null;
};

const DATE_EXPRESSION =
  /一昨日|昨日|今日|明後日|明日|先週|今週|先月|今月|\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日/g;
const NUMBER_EXPRESSION = /-?\d+(?:\.\d+)?/g;
const WEIGHT_VALUE = /(-?\d+(?:\.\d+)?)\s*(?:kg|キログラム|キロ)/gi;
const BODY_FAT_VALUE =
  /体脂肪(?:率)?\s*(?:は|が|:|：)?\s*(-?\d+(?:\.\d+)?)\s*(?:%|パーセント)/gi;
const PERIOD_START =
  /生理(?:が|は)?\s*(?:始まった|始まりました|始まる|開始した|開始しました|きた|来た)/;
const PERIOD_START_HOMOPHONE =
  /^整理(?:が|は)?\s*(?:始まった|始まりました|始まる|開始した|開始しました|きた|来た)$/;
const PERIOD_NEGATION = /生理[^、。,.，\n]*(?:始まって(?:い)?ない|開始して(?:い)?ない|まだ|じゃない|ではない)/;
const COMPLEX_MARKERS =
  /(?:じゃなく|ではなく|訂正|間違|より|増え|減っ|減り|たぶん|多分|かも|くらい|ぐらい|およそ|約\s*\d)/;
const KNOWN_UNSUPPORTED =
  /(?:頭痛|腹痛|喉|だる|睡眠|血圧|体温|食事|運動|歩数|服薬|薬|水分|気分|ストレス)/;

export function parseLocalHealthText(
  input: string,
  now = new Date(),
): LocalHealthParseResult {
  const text = normalizeHealthText(input);
  if (!text || text.length > MAX_HEALTH_TEXT_LENGTH) {
    return { decision: "needs_confirmation", result: null };
  }

  const segments = text
    .split(/[、。，\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const entries: ModelHealthParse["entries"] = [];
  let activeDateExpression: string | null = null;
  let hasUnsupportedContent = false;
  let hasUnknownContent = false;

  for (const segment of segments) {
    const dateExpressions = Array.from(segment.matchAll(DATE_EXPRESSION), (match) => match[0]);
    if (dateExpressions.length > 1) {
      return { decision: "needs_ai", result: null };
    }
    if (dateExpressions[0]) activeDateExpression = dateExpressions[0];

    const withoutDate = normalizePeriodStartHomophone(
      segment.replace(DATE_EXPRESSION, " ").trim(),
    );
    const hasSupportedHint =
      /体重|kg|キログラム|キロ|体脂肪|生理/i.test(withoutDate);
    if (hasSupportedHint && COMPLEX_MARKERS.test(withoutDate)) {
      return { decision: "needs_ai", result: null };
    }

    const weightMatches = Array.from(withoutDate.matchAll(WEIGHT_VALUE));
    const bodyFatMatches = Array.from(withoutDate.matchAll(BODY_FAT_VALUE));
    if (weightMatches.length > 1 || bodyFatMatches.length > 1) {
      return { decision: "needs_ai", result: null };
    }

    if (weightMatches.length === 1) {
      entries.push({
        type: "weight",
        date_expression: activeDateExpression,
        value: Number(weightMatches[0][1]),
        unit: "kg",
      });
    } else if (/体重/.test(withoutDate)) {
      if (bodyFatMatches.length > 0 || /体脂肪|生理/.test(withoutDate)) {
        return { decision: "needs_ai", result: null };
      }
      const numbers = withoutDate.match(NUMBER_EXPRESSION) ?? [];
      if (numbers.length > 1) return { decision: "needs_ai", result: null };
      entries.push({
        type: "weight",
        date_expression: activeDateExpression,
        value: numbers[0] === undefined ? null : Number(numbers[0]),
        unit: null,
      });
    } else if (/(?:kg|キログラム|キロ)/i.test(withoutDate)) {
      return { decision: "needs_ai", result: null };
    }

    if (bodyFatMatches.length === 1) {
      entries.push({
        type: "body_fat",
        date_expression: activeDateExpression,
        value: Number(bodyFatMatches[0][1]),
        unit: "%",
      });
    } else if (/体脂肪/.test(withoutDate)) {
      if (weightMatches.length > 0 || /体重|生理/.test(withoutDate)) {
        return { decision: "needs_ai", result: null };
      }
      const numbers = withoutDate.match(NUMBER_EXPRESSION) ?? [];
      if (numbers.length > 1) return { decision: "needs_ai", result: null };
      entries.push({
        type: "body_fat",
        date_expression: activeDateExpression,
        value: numbers[0] === undefined ? null : Number(numbers[0]),
        unit: null,
      });
    }

    if (/生理/.test(withoutDate)) {
      if (PERIOD_NEGATION.test(withoutDate)) {
        hasUnsupportedContent = true;
      } else if (PERIOD_START.test(withoutDate)) {
        entries.push({
          type: "period_start",
          date_expression: activeDateExpression,
          value: null,
          unit: null,
        });
      } else {
        hasUnsupportedContent = true;
      }
    }

    if (KNOWN_UNSUPPORTED.test(withoutDate)) {
      hasUnsupportedContent = true;
    } else if (!hasSupportedHint && !/^(?:は|の|で|から)?$/.test(withoutDate)) {
      hasUnsupportedContent = true;
      hasUnknownContent = true;
    }
  }

  const duplicateType = entries.some(
    (entry, index) => entries.findIndex((candidate) => candidate.type === entry.type) !== index,
  );
  if (duplicateType) return { decision: "needs_ai", result: null };
  if (entries.length > 0 && hasUnknownContent) {
    return { decision: "needs_ai", result: null };
  }

  const reference = getTokyoReference(now);
  const result = validateAndNormalizeHealthParse(
    { entries, has_unsupported_content: hasUnsupportedContent },
    reference.referenceDate,
    text,
  );
  const needsConfirmation = result.entries.some((entry) => entry.needsConfirmation);
  return {
    decision: needsConfirmation ? "needs_confirmation" : "local_complete",
    result,
  };
}

export function normalizeHealthText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/おととい/g, "一昨日")
    .replace(/きのう/g, "昨日")
    .replace(/きょう/g, "今日")
    .replace(/,(?!\d)/g, "、")
    .replace(/\.(?!\d)/g, "。")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePeriodStartHomophone(segment: string): string {
  if (!PERIOD_START_HOMOPHONE.test(segment)) return segment;
  return segment.replace(/^整理/, "生理");
}
