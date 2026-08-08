"use client";

import AppErrorScreen from "@/components/AppErrorScreen";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const referenceCode = error.digest?.slice(0, 32);
  const detail = referenceCode
    ? `アプリ全体の読み込みエラーが発生しました。照合番号：${referenceCode}`
    : "アプリ全体の読み込みエラーが発生しました。";

  return (
    <html lang="ja">
      <body>
        <AppErrorScreen
          title="アプリを読み込めませんでした"
          description="通信や更新の影響で一時的な問題が発生した可能性があります。もう一度読み込んでください。"
          onRetry={reset}
          referenceCode={referenceCode}
          reportHref={`/feedback?from=/&detail=${encodeURIComponent(detail)}`}
        />
      </body>
    </html>
  );
}
