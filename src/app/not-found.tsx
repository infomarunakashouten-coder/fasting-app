import AppErrorScreen from "@/components/AppErrorScreen";

export default function NotFound() {
  return (
    <AppErrorScreen
      title="ページが見つかりません"
      description="URLが変更されたか、ページが削除された可能性があります。ホームから目的の画面を開いてください。"
    />
  );
}
