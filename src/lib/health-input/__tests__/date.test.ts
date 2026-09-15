import { describe, expect, it } from "vitest";

import { getTokyoReference, resolveHealthDate } from "../date";

describe("health input dates", () => {
  it("UTC日付ではなくAsia/Tokyoの日付を基準にする", () => {
    expect(getTokyoReference(new Date("2026-09-11T15:01:00Z")).referenceDate).toBe("2026-09-12");
  });

  it("一昨日をカレンダー日で解決する", () => {
    expect(resolveHealthDate("一昨日", "2026-03-01")).toEqual({
      status: "resolved",
      date: "2026-02-27",
    });
  });

  it("年月日が明示された日付を確定する", () => {
    expect(resolveHealthDate("2026年9月5日", "2026-09-12")).toEqual({
      status: "resolved",
      date: "2026-09-05",
    });
  });

  it("存在しない日付を拒否する", () => {
    expect(resolveHealthDate("2026年2月30日", "2026-09-12")).toEqual({
      status: "invalid",
      date: null,
    });
  });
});
