export type ChartPeriod = "7" | "14" | "30" | "90" | "365";

export type ChartPoint = {
  x: number;
  label: string;
  weight: number | null;
  bodyFat: number | null;
};

type RecordLike = {
  recorded_date: string;
  weight_kg?: number | null;
  weight?: number | null;
  body_fat_percentage?: number | null;
};

const dayMs = 86400000;

const toDate = (date: string) => new Date(`${date}T00:00:00`);

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const average = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => value !== null);
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1));
};

export const chartPeriodLabels: Record<ChartPeriod, string> = {
  "7": "7日",
  "14": "14日",
  "30": "1ヶ月",
  "90": "3ヶ月",
  "365": "1年",
};

export function getPeriodRange(period: ChartPeriod) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(start.getDate() - Number(period));
  start.setHours(0, 0, 0, 0);

  return {
    start,
    end,
    startTime: start.getTime(),
    endTime: end.getTime(),
  };
}

export function buildChartTicks(period: ChartPeriod) {
  const { startTime, endTime } = getPeriodRange(period);

  if (period === "365") {
    const ticks: number[] = [];
    const cursor = new Date(startTime);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);

    while (cursor.getTime() <= endTime) {
      ticks.push(cursor.getTime());
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return ticks;
  }

  const divisions = period === "90" ? 6 : period === "30" ? 5 : period === "14" ? 4 : 7;
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const time = startTime + ((endTime - startTime) / divisions) * index;
    return Math.round(time);
  });
}

export function formatChartTick(value: number, period: ChartPeriod) {
  const date = new Date(value);
  if (period === "365") return `${date.getMonth() + 1}月`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatTooltipDate(value: number, period: ChartPeriod) {
  const date = new Date(value);
  if (period === "365") return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  return date.toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
  });
}

export function buildRecordChartData(records: RecordLike[], period: ChartPeriod): ChartPoint[] {
  const { startTime, endTime } = getPeriodRange(period);
  const buckets = new Map<string, { xValues: number[]; weights: Array<number | null>; bodyFats: Array<number | null> }>();

  records.forEach((record) => {
    const time = toDate(record.recorded_date).getTime();
    if (time < startTime || time > endTime) return;

    const date = new Date(time);
    let key = record.recorded_date;

    if (period === "90") {
      const weekIndex = Math.floor((time - startTime) / (dayMs * 7));
      key = `week-${weekIndex}`;
    }

    if (period === "365") {
      key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    }

    const bucket = buckets.get(key) ?? { xValues: [], weights: [], bodyFats: [] };
    bucket.xValues.push(time);
    bucket.weights.push(toNumber(record.weight_kg ?? record.weight));
    bucket.bodyFats.push(toNumber(record.body_fat_percentage));
    buckets.set(key, bucket);
  });

  return Array.from(buckets.values())
    .map((bucket) => {
      const x = Math.round(bucket.xValues.reduce((sum, value) => sum + value, 0) / bucket.xValues.length);
      return {
        x,
        label: formatTooltipDate(x, period),
        weight: average(bucket.weights),
        bodyFat: average(bucket.bodyFats),
      };
    })
    .sort((a, b) => a.x - b.x);
}
