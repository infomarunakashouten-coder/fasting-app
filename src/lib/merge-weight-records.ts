type DatedRecord = {
  recorded_date: string;
};

export function mergeWeightRecordsByDate<T extends DatedRecord>(
  currentRecords: T[] = [],
  legacyRecords: T[] = [],
  direction: "asc" | "desc" = "desc"
) {
  const records = new Map<string, T>();

  legacyRecords.forEach((record) => {
    records.set(record.recorded_date, record);
  });

  // daily_records is the current source of truth when both tables contain a date.
  currentRecords.forEach((record) => {
    records.set(record.recorded_date, record);
  });

  return Array.from(records.values()).sort((a, b) =>
    direction === "asc"
      ? a.recorded_date.localeCompare(b.recorded_date)
      : b.recorded_date.localeCompare(a.recorded_date)
  );
}
