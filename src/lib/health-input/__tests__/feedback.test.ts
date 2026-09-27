import { describe, expect, it } from "vitest";

import {
  getNoSupportedHealthEntryFeedback,
  NO_SUPPORTED_HEALTH_ENTRY_MESSAGE,
} from "../feedback";

describe("getNoSupportedHealthEntryFeedback", () => {
  it("非空入力に解析対象がない場合は明示的なUIメッセージを返す", () => {
    expect(getNoSupportedHealthEntryFeedback("対象外の入力", 0)).toBe(
      NO_SUPPORTED_HEALTH_ENTRY_MESSAGE,
    );
    expect(NO_SUPPORTED_HEALTH_ENTRY_MESSAGE).toContain("入力内容をご確認ください");
    expect(NO_SUPPORTED_HEALTH_ENTRY_MESSAGE).toContain("体重・体脂肪率・生理開始");
  });

  it("解析対象がある場合は対象外エラーを返さない", () => {
    expect(getNoSupportedHealthEntryFeedback("今日52.6キロ", 1)).toBeNull();
  });
});
