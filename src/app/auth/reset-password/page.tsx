"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import { createClient } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setHasRecoverySession(Boolean(session));
      setChecking(false);
    };

    void checkSession();
  }, [supabase]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }
    if (password !== passwordConfirm) {
      setError("パスワードが一致していません。");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(
        getUserFacingError(
          updateError,
          "パスワードを変更できませんでした。再設定メールからもう一度お試しください。"
        )
      );
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    setSuccess(true);
    setLoading(false);
  };

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f1eb] text-sm text-stone-400">
        再設定リンクを確認しています...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-10 text-slate-950">
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[430px] flex-col justify-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white text-4xl shadow-sm">
            🌿
          </div>
          <h1 className="text-3xl font-bold text-[#4f8d89]">新しいパスワード</h1>
          <p className="mt-3 text-base text-stone-400">8文字以上で設定してください</p>
        </div>
        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          {!hasRecoverySession ? (
            <div className="py-4 text-center">
              <h2 className="text-xl font-bold">再設定リンクを確認できません</h2>
              <p className="mt-3 text-sm leading-7 text-stone-500">
                リンクの有効期限が切れているか、すでに使用されています。
                再設定メールをもう一度送ってください。
              </p>
              <Link
                href="/auth/forgot-password"
                className="mt-5 block rounded-2xl bg-[#5f9f9b] py-4 text-base font-bold text-white"
              >
                再設定メールを送る
              </Link>
              <Link
                href="/auth/login"
                className="mt-4 block text-sm font-bold text-[#4f8d89]"
              >
                ログイン画面へ戻る
              </Link>
            </div>
          ) : success ? (
            <div className="py-4 text-center">
              <h2 className="text-xl font-bold">変更しました</h2>
              <p className="mt-3 text-sm leading-7 text-stone-500">
                新しいパスワードでログインできます。
              </p>
              <Link
                href="/auth/login"
                className="mt-5 block rounded-2xl bg-[#5f9f9b] py-4 text-base font-bold text-white"
              >
                ログインする
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-stone-600">新しいパスワード</span>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  minLength={8}
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full rounded-2xl border border-stone-200 px-5 py-4 outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-stone-600">パスワード確認</span>
                <PasswordInput
                  value={passwordConfirm}
                  onChange={setPasswordConfirm}
                  minLength={8}
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full rounded-2xl border border-stone-200 px-5 py-4 outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50"
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
                {loading ? "変更中..." : "パスワードを変更"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
