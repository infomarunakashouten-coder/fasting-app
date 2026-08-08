"use client";

import { useEffect } from "react";
import AppErrorScreen from "@/components/AppErrorScreen";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const referenceCode = error.digest?.slice(0, 32);
  const detail = referenceCode
    ? `画面エラーが発生しました。照合番号：${referenceCode}`
    : "画面エラーが発生しました。再読み込みしても解消しませんでした。";

  return (
    <AppErrorScreen
      onRetry={reset}
      referenceCode={referenceCode}
      reportHref={`/feedback?from=/&detail=${encodeURIComponent(detail)}`}
    />
  );
}
