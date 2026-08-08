"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { LEGAL_VERSION } from "@/lib/legal";
import { createClient } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";

export default function RegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (password !== passwordConfirm) {
      setError("パスワードが一致していません。");
      return;
    }

    if (password.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("メールアドレスを入力してください。");
      return;
    }
    if (!agreed) {
      setError("利用規約とプライバシーポリシーへの同意が必要です。");
      return;
    }

    setLoading(true);
    const acceptedAt = new Date().toISOString();
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/profile/setup")}`,
        data: {
          terms_accepted_at: acceptedAt,
          terms_version: LEGAL_VERSION,
          privacy_accepted_at: acceptedAt,
          privacy_version: LEGAL_VERSION,
        },
      },
    });

    if (signUpError) {
      setError(
        getUserFacingError(
          signUpError,
          "登録できませんでした。時間をおいてもう一度お試しください。"
        )
      );
    } else if (signUpData.session) {
      router.push("/");
      router.refresh();
    } else {
      setEmail(normalizedEmail);
      setSuccess(true);
    }

    setLoading(false);
  };

  const resendConfirmation = async () => {
    setResending(true);
    setResendMessage("");
    setError("");
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/profile/setup")}`,
      },
    });
    setResending(false);
    if (resendError) {
      setError(
        getUserFacingError(
          resendError,
          "再送できませんでした。少し時間をおいてお試しください。"
        )
      );
      return;
    }
    setResendMessage("確認メールを再送しました。");
  };

  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-10 text-slate-950">
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[430px] flex-col justify-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
            <span className="text-4xl">🌿</span>
          </div>
          <h1 className="text-4xl font-bold text-[#4f8d89]">新規登録</h1>
          <p className="mt-4 text-lg text-stone-400">記録を始めるためのアカウントを作ります</p>
        </div>

        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          {success ? (
            <div className="py-5 text-center">
              <div className="text-4xl">✉️</div>
              <h2 className="mt-4 text-2xl font-bold">確認メールを送信しました</h2>
              <p className="mt-3 text-sm leading-7 text-stone-500">
                <span className="font-bold text-[#4f8d89]">{email}</span> に確認メールを送りました。
                メール内のリンクから登録を完了してください。
              </p>
              <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-xs leading-6 text-stone-500">
                メールが見つからない場合は、迷惑メールフォルダを確認してください。
              </p>
              <button
                type="button"
                onClick={resendConfirmation}
                disabled={resending}
                className="mt-4 rounded-xl border border-teal-200 px-5 py-3 text-sm font-bold text-[#4f8d89] disabled:opacity-60"
              >
                {resending ? "再送中..." : "確認メールを再送"}
              </button>
              {resendMessage && (
                <p
                  role="status"
                  className="mt-3 text-xs font-bold text-teal-700"
                >
                  {resendMessage}
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  aria-live="polite"
                  className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600"
                >
                  {error}
                </p>
              )}
              <Link href="/auth/login" className="mt-5 inline-block text-sm font-bold text-[#4f8d89]">
                ログイン画面へ
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleRegister}>
                <div className="space-y-5">
                  <div>
                    <label className="mb-2 block text-sm font-bold text-stone-600">メールアドレス</label>
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
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-stone-600">
                      パスワード <span className="font-normal text-stone-400">8文字以上</span>
                    </label>
                    <PasswordInput
                      value={password}
                      onChange={setPassword}
                      autoComplete="new-password"
                      minLength={8}
                      disabled={loading}
                      className="w-full rounded-2xl border border-stone-200 bg-white px-5 py-4 text-base outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50"
                      placeholder="••••••••"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-stone-600">パスワード確認</label>
                    <PasswordInput
                      value={passwordConfirm}
                      onChange={setPasswordConfirm}
                      autoComplete="new-password"
                      minLength={8}
                      disabled={loading}
                      className="w-full rounded-2xl border border-stone-200 bg-white px-5 py-4 text-base outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50"
                      placeholder="••••••••"
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(event) => setAgreed(event.target.checked)}
                      disabled={loading}
                      className="mt-1 h-4 w-4 accent-[#5f9f9b]"
                    />
                    <span>
                      <Link href="/terms" target="_blank" className="font-bold text-[#4f8d89]">利用規約</Link>
                      と
                      <Link href="/privacy" target="_blank" className="font-bold text-[#4f8d89]">プライバシーポリシー</Link>
                      を確認し、同意します。
                    </span>
                  </label>

                  {error && (
                    <p role="alert" aria-live="polite" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !agreed}
                    className="w-full rounded-2xl bg-[#5f9f9b] py-4 text-lg font-bold text-white shadow-sm disabled:opacity-60"
                  >
                    {loading ? "登録中..." : "アカウントを作成"}
                  </button>
                </div>
              </form>

              <p className="mt-6 text-center text-sm text-stone-500">
                すでにアカウントをお持ちの方は{" "}
                <Link href="/auth/login" className="font-bold text-[#4f8d89]">
                  ログイン
                </Link>
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
