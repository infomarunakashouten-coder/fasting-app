import Link from "next/link";

const STEPS = [
  {
    number: "1",
    title: "アカウントを作成",
    body: "メールアドレスを登録し、届いた確認メールからプロフィールを設定します。",
  },
  {
    number: "2",
    title: "いつも通り使う",
    body: "体重記録、グラフ、ファスティング計画、ひろばなどをお試しください。",
  },
  {
    number: "3",
    title: "気づいたことを送る",
    body: "設定画面の「ご意見・不具合を送る」から、使いにくさやご要望を運営へ送れます。",
  },
];

const CHECKS = [
  {
    title: "プロフィールを確認",
    body: "身長、生年月日、開始体重、目標体重を保存し、BMIが表示されるか確認します。",
  },
  {
    title: "今日の記録を保存",
    body: "体重または体脂肪率を入力し、ホームと体重画面に同じ内容が表示されるか確認します。",
  },
  {
    title: "ファスティング計画を作成",
    body: "安全確認を読み、開始日と日数を選んで計画を保存します。無理に実施する必要はありません。",
  },
  {
    title: "ひろばを試す",
    body: "投稿、いいね、削除などを試します。個人を特定できる内容は投稿しないでください。",
  },
  {
    title: "設定を確認",
    body: "アイコン変更、データの書き出し、プラン表示などを確認します。アカウント削除は試用終了時だけ行ってください。",
  },
];

export default function MonitorPage() {
  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-8 text-slate-950">
      <main className="mx-auto max-w-[520px]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <p className="text-sm font-bold text-[#5d9997]">ファスティング倶楽部</p>
          <h1 className="mt-2 text-3xl font-bold">モニター参加のご案内</h1>
          <p className="mt-3 text-base leading-7 text-stone-500">
            試作アプリを実際に使い、気づいたことを教えてください。
          </p>
        </header>

        <section className="mt-5 border border-teal-200 bg-teal-50 px-5 py-5">
          <p className="font-bold text-teal-800">試用期間中の料金はかかりません</p>
          <p className="mt-2 text-sm leading-7 text-teal-800">
            画面に月額料金やプラン名が表示されても、現在は動作確認用です。
            実際の決済や請求は行われません。
          </p>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Link
            href="/auth/login"
            className="rounded-xl border border-stone-200 bg-white py-4 text-center font-bold text-stone-600"
          >
            ログイン
          </Link>
          <Link
            href="/auth/register"
            className="rounded-xl bg-[#5d9997] py-4 text-center font-bold text-white"
          >
            試用を始める
          </Link>
        </div>

        <section className="mt-5 bg-white px-5 py-6">
          <h2 className="text-xl font-bold">参加方法</h2>
          <div className="mt-5 divide-y divide-stone-100">
            {STEPS.map((step) => (
              <div key={step.number} className="flex gap-4 py-5 first:pt-0 last:pb-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5d9997] text-sm font-bold text-white">
                  {step.number}
                </span>
                <div>
                  <h3 className="font-bold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-7 text-stone-500">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 bg-white px-5 py-6">
          <h2 className="text-xl font-bold">登録時のご注意</h2>
          <div className="mt-4 space-y-3 text-sm leading-7 text-stone-500">
            <p>
              新規登録後、入力したメールアドレスへ確認メールが届きます。
              メール内のリンクを開くとプロフィール登録へ進めます。
            </p>
            <p>
              メールが届かない場合は迷惑メールフォルダを確認し、登録画面の再送ボタンをお試しください。
            </p>
            <p>
              パスワードを忘れた場合は、ログイン画面の「パスワードを忘れた方」から再設定できます。
            </p>
          </div>
        </section>

        <section className="mt-5 border border-amber-200 bg-amber-50 px-5 py-5">
          <h2 className="font-bold text-amber-900">安全について</h2>
          <p className="mt-2 text-sm leading-7 text-amber-900">
            本アプリは記録と情報整理を目的とし、診断や治療を行うものではありません。
            体調に不安がある場合はファスティングを行わず、医療専門家へ相談してください。
          </p>
        </section>

        <section className="mt-5 bg-white px-5 py-6">
          <h2 className="text-xl font-bold">試してほしいこと</h2>
          <p className="mt-2 text-sm leading-7 text-stone-500">
            すべてを一度に行う必要はありません。普段使うスマートフォンで、できる範囲からお試しください。
          </p>
          <div className="mt-4 divide-y divide-stone-100">
            {CHECKS.map((item) => (
              <div key={item.title} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[#5d9997] text-xs font-bold text-[#5d9997]"
                  >
                    ✓
                  </span>
                  <div>
                    <h3 className="font-bold">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-stone-500">{item.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 bg-white px-5 py-6">
          <h2 className="text-xl font-bold">気づいたことの送り方</h2>
          <p className="mt-3 text-sm leading-7 text-stone-500">
            「どの画面で」「何を押したとき」「どうなったか」の3点があると、原因を確認しやすくなります。
            エラーが表示された場合は、その文面やスクリーンショットも残しておいてください。
          </p>
          <p className="mt-3 rounded-xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
            例：体重画面で6月13日の記録を保存したら、「保存に失敗しました」と表示されました。
          </p>
          <Link
            href="/feedback?from=/monitor"
            className="mt-4 block rounded-xl bg-[#5d9997] py-3 text-center font-bold text-white"
          >
            ご意見・不具合を送る
          </Link>
        </section>

        <section className="mt-5 bg-white px-5 py-6">
          <h2 className="text-xl font-bold">保存する情報</h2>
          <p className="mt-3 text-sm leading-7 text-stone-500">
            メールアドレス、プロフィール、体重・体調の記録、投稿内容などを保存します。
            設定画面からデータの書き出しやアカウントの完全削除ができます。
          </p>
          <div className="mt-4 flex gap-4 text-sm font-bold text-[#4d8b8a]">
            <Link href="/terms">利用規約</Link>
            <Link href="/privacy">プライバシーポリシー</Link>
          </div>
        </section>

        <div className="mb-4 mt-6 grid grid-cols-2 gap-3">
          <Link
            href="/auth/login"
            className="rounded-xl border border-stone-200 bg-white py-4 text-center font-bold text-stone-600"
          >
            ログイン
          </Link>
          <Link
            href="/auth/register"
            className="rounded-xl bg-[#5d9997] py-4 text-center font-bold text-white"
          >
            試用を始める
          </Link>
        </div>
      </main>
    </div>
  );
}
