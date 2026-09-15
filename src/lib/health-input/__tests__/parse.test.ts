import { describe, expect, it, vi } from "vitest";

import { parseHealthText, HealthParseError, type HealthParseProvider } from "../parse";
import { AI_CONSENT_VERSION, MAX_HEALTH_TEXT_LENGTH } from "../schema";

const NOW = new Date("2026-09-11T15:30:00.000Z");
const request = (text: string) => ({ text, consentVersion: AI_CONSENT_VERSION });
const provider = (output: unknown): HealthParseProvider => ({
  parse: vi.fn().mockResolvedValue(output),
});
const entry = (
  type: "weight" | "body_fat" | "period_start",
  dateExpression: string | null,
  value: number | null,
  unit: "kg" | "%" | null,
) => ({ type, date_expression: dateExpression, value, unit });

describe("parseHealthText", () => {
  it("「今日52.6キロ」を体重として解析する", async () => {
    const result = await parseHealthText(
      request("今日52.6キロ"),
      provider({ entries: [entry("weight", "今日", 52.6, "kg")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries).toEqual([
      expect.objectContaining({ type: "weight", occurredOn: "2026-09-12", value: 52.6, issues: [] }),
    ]);
  });

  it("日付なしの体脂肪率を東京の今日として解析する", async () => {
    const result = await parseHealthText(
      request("体脂肪23.4パーセント"),
      provider({ entries: [entry("body_fat", null, 23.4, "%")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0]).toMatchObject({
      type: "body_fat",
      occurredOn: "2026-09-12",
      value: 23.4,
      needsConfirmation: false,
    });
  });

  it("「今日生理始まった」を生理開始として解析する", async () => {
    const result = await parseHealthText(
      request("今日生理始まった"),
      provider({ entries: [entry("period_start", "今日", null, null)], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0]).toMatchObject({
      type: "period_start",
      occurredOn: "2026-09-12",
      value: null,
      unit: null,
    });
  });

  it("1回の入力を3件の独立した記録へ分割する", async () => {
    const result = await parseHealthText(
      request("今日52.6キロ、体脂肪23.4パーセント。今日生理始まった"),
      provider({
        entries: [
          entry("weight", "今日", 52.6, "kg"),
          entry("body_fat", "今日", 23.4, "%"),
          entry("period_start", "今日", null, null),
        ],
        has_unsupported_content: false,
      }),
      NOW,
    );
    expect(result.entries.map(({ type }) => type)).toEqual([
      "weight",
      "body_fat",
      "period_start",
    ]);
  });

  it("「昨日53キロ」を東京基準日の前日として解析する", async () => {
    const result = await parseHealthText(
      request("昨日53キロ"),
      provider({ entries: [entry("weight", "昨日", 53, "kg")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0].occurredOn).toBe("2026-09-11");
  });

  it("数値なしは確認・修正対象にする", async () => {
    const result = await parseHealthText(
      request("今日の体重"),
      provider({ entries: [entry("weight", "今日", null, "kg")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0]).toMatchObject({
      needsConfirmation: true,
      issues: ["missing_value"],
    });
  });

  it("対象外健康項目だけの入力を拒否する", async () => {
    await expect(
      parseHealthText(
        request("今日は頭痛"),
        provider({ entries: [], has_unsupported_content: true }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: "NO_SUPPORTED_ENTRIES" });
  });

  it("不正なAI出力を拒否する", async () => {
    await expect(parseHealthText(request("今日52キロ"), provider("not-json"), NOW)).rejects.toMatchObject({
      code: "INVALID_AI_OUTPUT",
    });
  });

  it("体脂肪率の異常値を確認・修正対象にする", async () => {
    const result = await parseHealthText(
      request("体脂肪234パーセント"),
      provider({ entries: [entry("body_fat", null, 234, "%")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0].issues).toContain("out_of_range");
  });

  it("体重の異常値を確認・修正対象にする", async () => {
    const result = await parseHealthText(
      request("体重526キロ"),
      provider({ entries: [entry("weight", null, 526, "kg")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0].issues).toContain("out_of_range");
  });

  it("年なしの日付を自動確定しない", async () => {
    const result = await parseHealthText(
      request("9月5日52キロ"),
      provider({ entries: [entry("weight", "9月5日", 52, "kg")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0]).toMatchObject({
      occurredOn: null,
      needsConfirmation: true,
      issues: ["ambiguous_date"],
    });
  });

  it("AIが年なし日付へ年を補っても自動確定しない", async () => {
    const result = await parseHealthText(
      request("9月5日52キロ"),
      provider({ entries: [entry("weight", "2026-09-05", 52, "kg")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0]).toMatchObject({
      occurredOn: null,
      needsConfirmation: true,
      issues: ["ambiguous_date"],
    });
  });

  it("AIが年なし日付を省略しても今日として確定しない", async () => {
    const result = await parseHealthText(
      request("9月5日52キロ"),
      provider({ entries: [entry("weight", null, 52, "kg")], has_unsupported_content: false }),
      NOW,
    );
    expect(result.entries[0]).toMatchObject({ occurredOn: null, issues: ["ambiguous_date"] });
  });

  it("空入力をAIへ送信せず拒否する", async () => {
    const fakeProvider = provider({ entries: [], has_unsupported_content: false });
    await expect(parseHealthText(request("   "), fakeProvider, NOW)).rejects.toBeInstanceOf(HealthParseError);
    expect(fakeProvider.parse).not.toHaveBeenCalled();
  });

  it("非常に長い入力をAIへ送信せず拒否する", async () => {
    const fakeProvider = provider({ entries: [], has_unsupported_content: false });
    await expect(
      parseHealthText(request("あ".repeat(MAX_HEALTH_TEXT_LENGTH + 1)), fakeProvider, NOW),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fakeProvider.parse).not.toHaveBeenCalled();
  });

  it("同意バージョンがない入力をAIへ送信せず拒否する", async () => {
    const fakeProvider = provider({ entries: [], has_unsupported_content: false });
    await expect(parseHealthText({ text: "今日52キロ" }, fakeProvider, NOW)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fakeProvider.parse).not.toHaveBeenCalled();
  });
});
