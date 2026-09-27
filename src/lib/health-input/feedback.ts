export const NO_SUPPORTED_HEALTH_ENTRY_MESSAGE =
  "対象項目を認識できませんでした。入力内容をご確認ください。対応項目：体重・体脂肪率・生理開始";

export function getNoSupportedHealthEntryFeedback(
  input: string,
  entryCount: number,
): string | null {
  if (!input.trim() || entryCount > 0) return null;
  return NO_SUPPORTED_HEALTH_ENTRY_MESSAGE;
}
