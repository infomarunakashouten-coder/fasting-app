import "server-only";

import OpenAI from "openai";

import { HealthParseError, type HealthParseContext, type HealthParseProvider } from "./parse";

const HEALTH_PARSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries", "has_unsupported_content"],
  properties: {
    entries: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "date_expression", "value", "unit"],
        properties: {
          type: { type: "string", enum: ["weight", "body_fat", "period_start"] },
          date_expression: { type: ["string", "null"] },
          value: { type: ["number", "null"] },
          unit: { type: ["string", "null"], enum: ["kg", "%", null] },
        },
      },
    },
    has_unsupported_content: { type: "boolean" },
  },
} as const;

let openAIClient: OpenAI | null = null;

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new HealthParseError("AI_UNAVAILABLE");
  }
  openAIClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openAIClient;
}

export const openAIHealthParseProvider: HealthParseProvider = {
  async parse(text: string, context: HealthParseContext) {
    const response = await getOpenAIClient().responses.create({
      model: process.env.OPENAI_HEALTH_PARSE_MODEL || "gpt-4o-mini",
      store: false,
      instructions: buildHealthParseInstructions(context),
      input: text,
      text: {
        format: {
          type: "json_schema",
          name: "health_input_entries",
          strict: true,
          schema: HEALTH_PARSE_JSON_SCHEMA,
        },
      },
    });

    if (!response.output_text) {
      throw new HealthParseError("INVALID_AI_OUTPUT");
    }

    try {
      return JSON.parse(response.output_text) as unknown;
    } catch {
      throw new HealthParseError("INVALID_AI_OUTPUT");
    }
  },
};

function buildHealthParseInstructions(context: HealthParseContext) {
  return [
    "あなたは日本語の健康記録入力を、指定されたJSON Schemaだけで返す解析器です。",
    "対象は weight（体重）、body_fat（体脂肪率）、period_start（生理開始）だけです。",
    "睡眠、症状、食事、運動など対象外の内容を別カテゴリへ変換しないでください。",
    "1回の入力に複数項目があれば、項目ごとに独立したentries要素を作ってください。",
    "体重のunitはkg、体脂肪率のunitは%、period_startのvalueとunitはnullです。",
    "数値や単位が不明でも対象項目が明示されていれば、推測せずnullにしてください。",
    "date_expressionは原文の日付表現を保持してください。日付指定がなければnullです。",
    "同じ文脈の日付が後続項目にもかかる場合は、その日付表現を各項目へ付けてください。",
    "年のない日付へ年を補完しないでください。現在日時を推測しないでください。",
    `timezone=${context.timezone}`,
    `reference_datetime=${context.referenceDateTime}`,
    `reference_date=${context.referenceDate}`,
    "対象外の内容を一部でも含む場合はhas_unsupported_content=trueにしてください。",
    "医学的な判断、診断、助言、値の補正はしないでください。",
  ].join("\n");
}
