"use client";

import { useState } from "react";

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  minLength?: number;
  className?: string;
  disabled?: boolean;
};

export default function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
  minLength,
  className = "",
  disabled = false,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        disabled={disabled}
        className={`${className} pr-16`}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label={visible ? "パスワードを隠す" : "パスワードを表示"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 px-4 text-xs font-bold text-[#4f8d89] disabled:opacity-50"
      >
        {visible ? "隠す" : "表示"}
      </button>
    </div>
  );
}
