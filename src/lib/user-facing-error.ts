type AppError = {
  code?: string | null;
  message?: string | null;
};

type ErrorOptions = {
  duplicateMessage?: string;
  setupMessage?: string;
};

export const isMissingDatabaseObjectError = (
  error: AppError | null | undefined
) => {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  return (
    code === "PGRST202" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("could not find the function") ||
    message.includes("does not exist")
  );
};

export const getUserFacingError = (
  error: AppError | null | undefined,
  fallback: string,
  options: ErrorOptions = {}
) => {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    message.includes("already registered") ||
    message.includes("already been registered")
  ) {
    return "このメールアドレスは登録済みです。ログインまたはパスワード再設定をお試しください。";
  }

  if (code === "email_address_invalid" || message.includes("invalid email")) {
    return "メールアドレスの形式を確認してください。";
  }

  if (code === "weak_password" || message.includes("password should be")) {
    return "より安全なパスワードを設定してください。8文字以上で、英字と数字を組み合わせるのがおすすめです。";
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    message.includes("rate limit")
  ) {
    return "短時間に操作が集中しました。少し時間をおいてから、もう一度お試しください。";
  }

  if (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed")
  ) {
    return "通信できませんでした。接続を確認して、もう一度お試しください。";
  }

  if (
    code === "PGRST301" ||
    message.includes("jwt") ||
    message.includes("refresh token") ||
    message.includes("session")
  ) {
    return "ログインの有効期限が切れました。もう一度ログインしてください。";
  }

  if (
    code === "42501" ||
    message.includes("row-level security") ||
    message.includes("permission denied")
  ) {
    return "この操作を行う権限を確認できませんでした。再読み込みして、もう一度お試しください。";
  }

  if (isMissingDatabaseObjectError(error)) {
    return (
      options.setupMessage ??
      "アプリのデータ設定がまだ完了していません。管理者へお問い合わせください。"
    );
  }

  if (code === "23505" || message.includes("duplicate key")) {
    return options.duplicateMessage ?? "同じ内容がすでに保存されています。画面を再読み込みしてください。";
  }

  if (
    code === "23514" ||
    message.includes("check constraint") ||
    message.includes("invalid input syntax")
  ) {
    return "入力内容を確認してください。範囲外の値が含まれている可能性があります。";
  }

  return fallback;
};
