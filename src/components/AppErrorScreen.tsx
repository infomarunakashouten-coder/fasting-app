"use client";

import Link from "next/link";

export default function AppErrorScreen({
  title = "画面を表示できませんでした",
  description = "一時的な問題が発生しました。再読み込みしても直らない場合は、少し時間をおいてお試しください。",
  onRetry,
  referenceCode,
  reportHref,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  referenceCode?: string;
  reportHref?: string;
}) {
  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-10 text-slate-950">
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[430px] items-center">
        <section className="w-full rounded-[24px] bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 text-3xl">
            🌿
          </div>
          <h1 className="mt-5 text-2xl font-bold">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-stone-500">{description}</p>
          {referenceCode && (
            <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-500">
              照合番号：<span className="font-bold text-stone-700">{referenceCode}</span>
            </p>
          )}

          <div className="mt-6 space-y-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="w-full rounded-xl bg-[#5f9f9b] py-3 font-bold text-white"
              >
                もう一度読み込む
              </button>
            )}
            <Link
              href="/dashboard"
              className="block w-full rounded-xl border border-stone-200 py-3 font-bold text-stone-600"
            >
              ホームへ戻る
            </Link>
            {reportHref && (
              <Link
                href={reportHref}
                className="block w-full py-2 text-sm font-bold text-[#4d8b8a]"
              >
                この不具合を報告する
              </Link>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
