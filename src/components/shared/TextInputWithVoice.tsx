"use client";

import { useCallback, useId, useRef } from "react";
import { VoiceInput } from "./VoiceInput";

type CommonProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  name?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "search" | "none" | "tel" | "url" | "email" | "decimal";
};

type InputProps = CommonProps & {
  multiline?: false;
  type?: string;
};

type TextareaProps = CommonProps & {
  multiline: true;
  rows?: number;
};

type Props = InputProps | TextareaProps;

export function TextInputWithVoice(props: Props) {
  const { multiline, className = "", ...rest } = props;
  const uid = useId();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const handleTranscript = useCallback(
    (text: string) => {
      const el = inputRef.current;
      if (!el) return;

      const current = el.value;
      const appended = current ? `${current} ${text}` : text;

      const setter = multiline
        ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
        : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

      if (setter) {
        setter.call(el, appended);
      } else {
        el.value = appended;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [multiline],
  );

  const inputId = `voice-${uid}`;

  // Ensure w-full is present so the input fills its grid/flex parent
  const inputClass = className.includes("w-full")
    ? `${className} pr-10`
    : `${className} w-full pr-10`;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          id={inputId}
          {...(rest as Omit<TextareaProps, "multiline">)}
          className={inputClass}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          id={inputId}
          {...(rest as Omit<InputProps, "multiline">)}
          className={inputClass}
        />
      )}
      <div
        style={{
          position: "absolute",
          right: 8,
          top: multiline ? 8 : "50%",
          transform: multiline ? undefined : "translateY(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "auto",
        }}
      >
        <VoiceInput onTranscript={handleTranscript} />
      </div>
    </div>
  );
}
