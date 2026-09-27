import { describe, expect, it } from "vitest";

import { parseLocalHealthText } from "../local-parser";

const NOW = new Date("2026-09-15T15:30:00.000Z");

describe("parseLocalHealthText", () => {
  it.each([
    ["今日52.6キロ", ["weight"]],
    ["昨日53キロ", ["weight"]],
    ["体脂肪23.4パーセント", ["body_fat"]],
    ["体脂肪23.4%", ["body_fat"]],
    ["今日生理始まった", ["period_start"]],
    [
      "今日52.6キロ、体脂肪23.4パーセント、生理始まった",
      ["weight", "body_fat", "period_start"],
    ],
    [
      "今日52.6キロ、体脂肪23.4%、生理始まった",
      ["weight", "body_fat", "period_start"],
    ],
  ])("%sをOpenAIなしで解析する", (text, types) => {
    const parsed = parseLocalHealthText(text, NOW);
    expect(parsed.decision, JSON.stringify(parsed)).toBe("local_complete");
    expect(parsed.result?.entries.map((entry) => entry.type)).toEqual(types);
  });

  it("Asia/Tokyo基準で昨日を解決する", () => {
    const parsed = parseLocalHealthText("昨日53キロ", NOW);
    expect(parsed.result?.entries[0]).toMatchObject({
      occurredOn: "2026-09-15",
      value: 53,
      unit: "kg",
    });
  });

  it("複数項目へ直前の日付を安全に引き継ぐ", () => {
    const parsed = parseLocalHealthText(
      "今日52.6キロ、体脂肪23.4パーセント、生理始まった",
      NOW,
    );
    expect(parsed.result?.entries.every((entry) => entry.occurredOn === "2026-09-16")).toBe(true);
  });

  it.each([
    "今日生理始まった",
    "今日整理始まった",
    "生理始まった",
    "整理が始まった",
  ])("%sを生理開始としてローカル解析する", (text) => {
    const parsed = parseLocalHealthText(text, NOW);
    expect(parsed.decision).toBe("local_complete");
    expect(parsed.result?.entries).toMatchObject([{ type: "period_start" }]);
  });

  it.each([
    "部屋の整理始まった",
    "書類の整理を始めた",
    "データ整理始めた",
  ])("%sを生理開始として扱わない", (text) => {
    const parsed = parseLocalHealthText(text, NOW);
    expect(parsed.result?.entries).toEqual([]);
    expect(parsed.result?.hasUnsupportedContent).toBe(true);
  });

  it("対象外だけの入力をOpenAI fallbackにしない", () => {
    const parsed = parseLocalHealthText("今日は頭痛", NOW);
    expect(parsed).toMatchObject({
      decision: "local_complete",
      result: { entries: [], hasUnsupportedContent: true },
    });
  });

  it("対象項目と明確な対象外項目はローカルで分離する", () => {
    const parsed = parseLocalHealthText("今日52.6キロ、頭痛があります", NOW);
    expect(parsed.decision).toBe("local_complete");
    expect(parsed.result).toMatchObject({
      entries: [{ type: "weight", value: 52.6 }],
      hasUnsupportedContent: true,
    });
  });

  it.each([
    "体脂肪234パーセント",
    "体重526キロ",
    "今日の体重",
    "体脂肪23.4",
    "9月5日52キロ",
  ])("%sを人間による修正対象にする", (text) => {
    const parsed = parseLocalHealthText(text, NOW);
    expect(parsed.decision).toBe("needs_confirmation");
    expect(parsed.result?.entries[0].needsConfirmation).toBe(true);
  });

  it.each([
    "昨日53キロで今日は52キロ",
    "前回より減って52.6キロ",
    "52.6キロから53キロ",
    "体重じゃなくて体脂肪23.4パーセント",
    "今日52.6キロ、これは目標です",
  ])("%sは意味を推測せずOpenAI解析候補にする", (text) => {
    expect(parseLocalHealthText(text, NOW).decision).toBe("needs_ai");
  });

  it("全角の数値と記号を正規化する", () => {
    const parsed = parseLocalHealthText("今日５２．６キロ、体脂肪２３．４％", NOW);
    expect(parsed.decision).toBe("local_complete");
    expect(parsed.result?.entries.map((entry) => entry.value)).toEqual([52.6, 23.4]);
  });
});
