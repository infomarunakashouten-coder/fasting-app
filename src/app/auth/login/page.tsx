"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f5f1eb] px-5 py-10 text-slate-950">
          <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[430px] flex-col justify-center">
            <p className="text-center text-stone-400">読み込み中...</p>
          </main>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const requestedPath = searchParams.get("next");
  const accountDeleted = searchParams.get("deleted") === "1";
  const authError = searchParams.get("authError");
  const nextPath =
    requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath
      : "/";

  const handlePasswordLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(
        signInError.code === "email_not_confirmed"
          ? "メールアドレスの確認が完了していません。確認メールのリンクを開いてから、もう一度ログインしてください。"
          : "ログインできませんでした。メールアドレスとパスワードを確認してください。"
      );
    } else {
      router.push(nextPath);
      router.refresh();
    }

    setLoading(false);
  };

  const handleMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    if (otpError) {
      setError("メールを送信できませんでした。時間をおいてもう一度お試しください。");
    } else {
      setEmail(email.trim());
      setMagicLinkSent(true);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-10 text-slate-950">
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[430px] flex-col justify-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
            <span className="text-4xl">🌿</span>
          </div>
          <h1 className="text-4xl font-bold text-[#4f8d89]">ファスティング倶楽部</h1>
          <p className="mt-4 text-lg text-stone-400">ファスティング記録をやさしくサポート</p>
        </div>

        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          {accountDeleted && (
            <p className="mb-5 rounded-2xl bg-teal-50 px-4 py-3 text-center text-sm font-bold text-teal-700">
              アカウントと保存データを削除しました。
            </p>
          )}
          {magicLinkSent ? (
            <div className="py-5 text-center">
              <div className="text-4xl">✉️</div>
              <h2 className="mt-4 text-2xl font-bold">メールを送信しました</h2>
              <p className="mt-3 text-sm leading-7 text-stone-500">
                <span className="font-bold text-[#4f8d89]">{email}</span> にログインリンクを送りました。
                メール内のリンクからログインしてください。
              </p>
              <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-xs leading-6 text-stone-500">
                メールが見つからない場合は、迷惑メールフォルダを確認してください。リンクは同じ端末のブラウザで開くとスムーズです。
              </p>
              <button
                type="button"
                onClick={() => setMagicLinkSent(false)}
                className="mt-5 text-sm font-bold text-[#4f8d89]"
              >
                入力画面に戻る
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5 grid grid-cols-2 rounded-full bg-stone-100 p-1">
                <button
                  type="button"
                  onClick={() => setMode("password")}
                  disabled={loading}
                  aria-pressed={mode === "password"}
                  className={`rounded-full py-3 text-sm font-bold transition ${
                    mode === "password" ? "bg-white text-[#4f8d89] shadow-sm" : "text-stone-400"
                  }`}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  onClick={() => setMode("magic")}
                  disabled={loading}
                  aria-pressed={mode === "magic"}
                  className={`rounded-full py-3 text-sm font-bold transition ${
                    mode === "magic" ? "bg-white text-[#4f8d89] shadow-sm" : "text-stone-400"
                  }`}
                >
                  メールリンク
                </button>
              </div>

              <form onSubmit={mode === "password" ? handlePasswordLogin : handleMagicLink}>
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

                  {mode === "password" && (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="block text-sm font-bold text-stone-600">パスワード</label>
                        <Link href="/auth/forgot-password" className="text-xs font-bold text-[#4f8d89]">
                          パスワードを忘れた方
                        </Link>
                      </div>
                      <PasswordInput
                        value={password}
                        onChange={setPassword}
                        autoComplete="current-password"
                        disabled={loading}
                        className="w-full rounded-2xl border border-stone-200 bg-white px-5 py-4 text-base outline-none focus:border-[#5f9f9b] focus:ring-4 focus:ring-teal-50"
                        placeholder="••••••••"
                      />
                    </div>
                  )}

                  {(error || authError) && (
                    <p
                      role="alert"
                      aria-live="polite"
                      className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600"
                    >
                      {error ||
                        (authError === "expired"
                          ? "ログインリンクの有効期限が切れているか、すでに使用されています。もう一度送信してください。"
                          : "ログインリンクを確認できませんでした。もう一度送信してください。")}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-[#5f9f9b] py-4 text-lg font-bold text-white shadow-sm disabled:opacity-60"
                  >
                    {loading ? "処理中..." : mode === "password" ? "ログイン" : "ログインリンクを送る"}
                  </button>
                </div>
              </form>

              <p className="mt-6 text-center text-sm text-stone-500">
                アカウントをお持ちでない方は{" "}
                <Link href="/auth/register" className="font-bold text-[#4f8d89]">
                  新規登録
                </Link>
              </p>
              <div className="mt-5 flex justify-center gap-5 border-t border-stone-100 pt-5 text-xs font-bold text-stone-400">
                <Link href="/monitor">モニター案内</Link>
                <Link href="/terms">利用規約</Link>
                <Link href="/privacy">プライバシーポリシー</Link>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
