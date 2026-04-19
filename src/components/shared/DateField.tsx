"use client";

import type { InputHTMLAttributes } from "react";
import { useTranslation } from "@/lib/i18n";

type DateFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  showHint?: boolean;
};

export function DateField({
  label,
  showHint = true,
  className,
  ...rest
}: DateFieldProps) {
  const { locale } = useTranslation();
  const hint = locale === "ru" ? "дд.мм.гггг" : "dd.mm.yyyy";

  return (
    <label className="flex w-full flex-col gap-1">
      {label ? (
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          {label}
        </span>
      ) : null}
      <input
        type="date"
        {...rest}
        className={className}
        aria-label={label ?? hint}
      />
      {showHint ? (
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}
