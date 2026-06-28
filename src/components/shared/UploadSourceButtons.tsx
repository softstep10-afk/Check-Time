"use client";

import { useRef } from "react";
import type { ChangeEvent } from "react";
import { Camera, FileText, Images } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { ACCEPT_ALL_UPLOADS } from "@/lib/upload-limits";

type UploadSourceButtonsProps = {
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  dataTestIdPrefix?: string;
};

export function UploadSourceButtons({
  onFiles,
  disabled = false,
  className = "grid grid-cols-3 gap-2",
  buttonClassName = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-50",
  dataTestIdPrefix = "upload-source",
}: UploadSourceButtonsProps) {
  const { t } = useTranslation();
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFiles(event.target.files);
    event.currentTarget.value = "";
  }

  return (
    <div className={className}>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        data-testid={`${dataTestIdPrefix}-camera-input`}
        onChange={handleChange}
        className="sr-only"
      />
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        disabled={disabled}
        data-testid={`${dataTestIdPrefix}-media-input`}
        onChange={handleChange}
        className="sr-only"
      />
      <input
        ref={filesInputRef}
        type="file"
        accept={ACCEPT_ALL_UPLOADS}
        multiple
        disabled={disabled}
        data-testid={`${dataTestIdPrefix}-files-input`}
        onChange={handleChange}
        className="sr-only"
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => cameraInputRef.current?.click()}
        data-testid={`${dataTestIdPrefix}-camera-button`}
        className={buttonClassName}
      >
        <Camera size={14} />
        {t("uploads.camera")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => mediaInputRef.current?.click()}
        data-testid={`${dataTestIdPrefix}-media-button`}
        className={buttonClassName}
      >
        <Images size={14} />
        {t("uploads.media")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => filesInputRef.current?.click()}
        data-testid={`${dataTestIdPrefix}-files-button`}
        className={buttonClassName}
      >
        <FileText size={14} />
        {t("uploads.files")}
      </button>
    </div>
  );
}
