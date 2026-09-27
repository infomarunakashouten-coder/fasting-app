import { describe, expect, it, vi } from "vitest";
import { getLatestMeasurements, loadLatestMeasurements, measurementNumber } from "./latest-measurements";
import { buildRecordChartData } from "./records-chart";

const a = { recorded_date: "2026-09-27", weight: 52.6, body_fat_percentage: 23.1 };
const b = { recorded_date: "2026-09-28", weight: null, body_fat_percentage: 23.4 };

describe("nullable measurement reads", () => {
  it("A: independently selects weight and body fat with their measurement dates", () => {
    expect(getLatestMeasurements([a, b])).toEqual({
      weight: { value: 52.6, recordedDate: "2026-09-27" },
      previousWeight: null,
      bodyFat: { value: 23.4, recordedDate: "2026-09-28" },
    });
  });
  it("B: latest weight with no recorded body fat", () => {
    const result = getLatestMeasurements([
      { ...a, body_fat_percentage: null },
      { ...b, weight: 52.4, body_fat_percentage: null },
    ]);
    expect(result.weight?.value).toBe(52.4);
    expect(result.previousWeight?.value).toBe(52.6);
    expect(result.bodyFat).toBeNull();
  });
  it("C: body-fat-only history does not create a weight of zero", () => {
    const result = getLatestMeasurements([{ ...a, weight: null }]);
    expect(result.weight).toBeNull();
    expect(result.bodyFat?.value).toBe(23.1);
  });
  it("E: skips multiple latest NULL weights without changing input order", () => {
    const rows = [a, b, { ...b, recorded_date: "2026-09-29" }];
    expect(getLatestMeasurements(rows).weight?.value).toBe(52.6);
    expect(rows[0]).toBe(a);
  });
  it("returns unrecorded values for empty history", () => {
    expect(getLatestMeasurements([])).toEqual({ weight: null, previousWeight: null, bodyFat: null });
  });
  it.each([null, undefined, "", NaN, Infinity])("does not coerce missing/nonfinite value %s to zero", (value) => {
    expect(measurementNumber(value)).toBeNull();
  });
  it("preserves finite numeric DB values", () => {
    expect(measurementNumber("52.6")).toBe(52.6);
  });
  it("D: chart preserves a missing weight, never drawing 0kg", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-28T12:00:00+09:00"));
      const points = buildRecordChartData([a, b], "14");
      expect(points.map((point) => point.weight)).toEqual([52.6, null]);
      expect(points.map((point) => point.bodyFat)).toEqual([23.1, 23.4]);
      expect(points.some((point) => point.weight === 0)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["90", "365"] as const)("averages only non-NULL values for %s-day chart buckets", (period) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-28T12:00:00+09:00"));
      const points = buildRecordChartData([a, b], period);
      expect(points.filter((point) => point.weight !== null).map((point) => point.weight)).toEqual([52.6]);
    } finally {
      vi.useRealTimers();
    }
  });
});

type Fixture = { recorded_date: string; weight: number | null; body_fat_percentage: number | null };

function fixtureClient(rows: Fixture[], error: { code: string; message: string } | null = null) {
  const calls: string[][] = [];
  const client = {
    from(table: string) {
      const operations = [table];
      calls.push(operations);
      let field: "weight" | "body_fat_percentage" = "weight";
      const query = {
        select(columns: string) { operations.push(`select:${columns}`); return query; },
        eq(column: string, value: string) { operations.push(`eq:${column}:${value}`); return query; },
        not(column: typeof field, operator: string, value: null) {
          operations.push(`not:${column}:${operator}:${value}`); field = column; return query;
        },
        order(column: string, options: { ascending: boolean }) {
          operations.push(`order:${column}:${options.ascending}`); return query;
        },
        limit(count: number) {
          operations.push(`limit:${count}`);
          const data = rows.filter((row) => row[field] !== null)
            .sort((x, y) => y.recorded_date.localeCompare(x.recorded_date))
            .slice(0, count)
            .map((row) => ({ recorded_date: row.recorded_date, [field]: row[field] }));
          return Promise.resolve({ data: error ? null : data, error });
        },
      };
      return query;
    },
  };
  return { client: client as unknown as Parameters<typeof loadLatestMeasurements>[0], calls };
}

describe("latest measurement DB queries", () => {
  it("filters each metric BEFORE LIMIT, selects only the owner and sorts descending", async () => {
    const { client, calls } = fixtureClient([a, b]);
    const result = await loadLatestMeasurements(client, "fixture-user");
    expect(result.error).toBeNull();
    expect(result.weight?.value).toBe(52.6);
    expect(result.bodyFat?.value).toBe(23.4);
    expect(calls).toEqual([
      ["weight_records", "select:recorded_date,weight", "eq:user_id:fixture-user", "not:weight:is:null", "order:recorded_date:false", "limit:2"],
      ["weight_records", "select:recorded_date,body_fat_percentage", "eq:user_id:fixture-user", "not:body_fat_percentage:is:null", "order:recorded_date:false", "limit:1"],
    ]);
  });
  it("retrieves a latest non-NULL value older than 400 NULL history rows", async () => {
    const rows: Fixture[] = Array.from({ length: 450 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1 + i));
      return { recorded_date: date.toISOString().slice(0, 10), weight: null, body_fat_percentage: 23.4 };
    });
    rows.push({ recorded_date: "2025-12-31", weight: 52.6, body_fat_percentage: null });
    const { client } = fixtureClient(rows);
    const result = await loadLatestMeasurements(client, "fixture-user");
    expect(result.weight).toEqual({ value: 52.6, recordedDate: "2025-12-31" });
    expect(result.bodyFat?.recordedDate).toBe(rows[449].recorded_date);
  });
  it("surfaces permission/network errors rather than reporting missing values as success", async () => {
    const error = { code: "42501", message: "permission denied" };
    const { client } = fixtureClient([], error);
    expect((await loadLatestMeasurements(client, "fixture-user")).error).toBe(error);
  });
});
