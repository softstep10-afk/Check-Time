"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, FileText, Image as ImageIcon, Images, Video } from "lucide-react";
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
  const [showGalleryChoices, setShowGalleryChoices] = useState(false);
  const galleryImageInputRef = useRef<HTMLInputElement | null>(null);
  const galleryVideoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const galleryChoicesId = `${dataTestIdPrefix}-gallery-choices`;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFiles(event.target.files);
    event.currentTarget.value = "";
    setShowGalleryChoices(false);
  }

  function openInput(input: HTMLInputElement | null) {
    setShowGalleryChoices(false);
    input?.click();
  }

  return (
    <div className={className}>
      <input
        ref={galleryImageInputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        data-testid={`${dataTestIdPrefix}-gallery-image-input`}
        onChange={handleChange}
        className="sr-only"
      />
      <input
        ref={galleryVideoInputRef}
        type="file"
        accept="video/*"
        multiple
        disabled={disabled}
        data-testid={`${dataTestIdPrefix}-gallery-video-input`}
        onChange={handleChange}
        className="sr-only"
      />
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
        onClick={() => setShowGalleryChoices((current) => !current)}
        aria-expanded={showGalleryChoices}
        aria-controls={galleryChoicesId}
        data-testid={`${dataTestIdPrefix}-gallery-button`}
        className={buttonClassName}
      >
        <Images size={14} />
        {t("uploads.gallery")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => openInput(cameraInputRef.current)}
        data-testid={`${dataTestIdPrefix}-camera-button`}
        className={buttonClassName}
      >
        <Camera size={14} />
        {t("uploads.camera")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => openInput(filesInputRef.current)}
        data-testid={`${dataTestIdPrefix}-files-button`}
        className={buttonClassName}
      >
        <FileText size={14} />
        {t("uploads.files")}
      </button>

      {showGalleryChoices ? (
        <div id={galleryChoicesId} data-testid={galleryChoicesId} className="col-span-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => openInput(galleryImageInputRef.current)}
            data-testid={`${dataTestIdPrefix}-gallery-image-button`}
            className={buttonClassName}
          >
            <ImageIcon size={14} />
            {t("gallery.typePhotos")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => openInput(galleryVideoInputRef.current)}
            data-testid={`${dataTestIdPrefix}-gallery-video-button`}
            className={buttonClassName}
          >
            <Video size={14} />
            {t("gallery.typeVideos")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
