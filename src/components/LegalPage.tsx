import Link from "next/link";

export default function LegalPage({
  eyebrow,
  title,
  updatedAt,
  sections,
}: {
  eyebrow: string;
  title: string;
  updatedAt: string;
  sections: Array<{ title: string; body: React.ReactNode }>;
}) {
  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-8 text-slate-950">
      <main className="mx-auto max-w-[680px]">
        <header className="rounded-[24px] bg-white p-6 shadow-sm">
          <p className="text-sm font-bold text-[#5d9997]">{eyebrow}</p>
          <h1 className="mt-1 text-3xl font-bold">{title}</h1>
          <p className="mt-3 text-sm text-stone-400">最終更新日：{updatedAt}</p>
        </header>

        <div className="mt-5 space-y-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-[20px] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">{section.title}</h2>
              <div className="mt-3 space-y-2 text-sm leading-7 text-stone-600">{section.body}</div>
            </section>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Link href="/terms" className="rounded-xl bg-white py-3 text-center text-sm font-bold text-[#4d8b8a]">
            利用規約
          </Link>
          <Link href="/privacy" className="rounded-xl bg-white py-3 text-center text-sm font-bold text-[#4d8b8a]">
            プライバシー
          </Link>
        </div>
        <Link href="/auth/login" className="mt-3 block py-3 text-center text-sm font-bold text-stone-500">
          アプリへ戻る
        </Link>
      </main>
    </div>
  );
}
