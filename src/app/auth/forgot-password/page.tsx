"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;

    setLoading(true);
    setError("");

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
      }
    );

    setLoading(false);
    if (resetError) {
      setError(
        getUserFacingError(
          resetError,
          "再設定メールを送信できませんでした。時間をおいてもう一度お試しください。"
        )
      );
      return;
    }

    setEmail(normalizedEmail);
    setSent(true);
  };

  return (
    <AuthShell title="パスワード再設定" description="登録したメールアドレスへ再設定リンクを送ります">
      {sent ? (
        <div className="py-4 text-center">
          <div className="text-4xl">✉️</div>
          <h2 className="mt-4 text-xl font-bold">メールを送信しました</h2>
          <p className="mt-3 text-sm leading-7 text-stone-500">
            <span className="font-bold text-[#4f8d89]">{email}</span> に再設定リンクを送りました。
          </p>
          <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-xs leading-6 text-stone-500">
            メールが見つからない場合は迷惑メールフォルダも確認してください。
          </p>
          <button type="button" onClick={() => setSent(false)} className="mt-5 text-sm font-bold text-[#4f8d89]">
            もう一度送る
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-stone-600">メールアドレス</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              disabled={loading}
              className="w-full rounded-2xl border border-stone-200 bg-white px-5 py-4 text-base outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50"
              placeholder="your@email.com"
            />
          </label>
          {error && (
            <p role="alert" aria-live="polite" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-[#5f9f9b] py-4 text-lg font-bold text-white disabled:opacity-60"
          >
            {loading ? "送信中..." : "再設定メールを送る"}
          </button>
          <Link href="/auth/login" className="block text-center text-sm font-bold text-[#4f8d89]">
            ログイン画面へ戻る
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-10 text-slate-950">
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[430px] flex-col justify-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white text-4xl shadow-sm">
            🌿
          </div>
          <h1 className="text-3xl font-bold text-[#4f8d89]">{title}</h1>
          <p className="mt-3 text-base text-stone-400">{description}</p>
        </div>
        <section className="rounded-[28px] bg-white p-6 shadow-sm">{children}</section>
      </main>
    </div>
  );
}
