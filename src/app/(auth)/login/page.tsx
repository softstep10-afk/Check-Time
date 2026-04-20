"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

const PIN_LENGTH = 4;

type Phase = "idle" | "loading" | "success" | "error";

export default function Page() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState(() => t("login.enterYourPin"));
  const [userName, setUserName] = useState("");
  const [clockText, setClockText] = useState("");
  const locked = phase !== "idle";
  const cardRef = useRef<HTMLDivElement>(null);

  // Live clock
  useEffect(() => {
    function tick() {
      const d = new Date();
      const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const months = [
        "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
        "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
      ];
      const h = d.getHours() % 12 || 12;
      const ap = d.getHours() >= 12 ? "PM" : "AM";
      const pad = (n: number) => String(n).padStart(2, "0");
      setClockText(
        `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} \u2014 ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ap}`
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const addDigit = useCallback(
    (n: string) => {
      if (locked) return;
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + n;
        setStatusText(
          next.length < PIN_LENGTH ? `${PIN_LENGTH - next.length} ${t("login.more")}` : t("login.ready")
        );
        return next;
      });
    },
    [locked]
  );

  const backspace = useCallback(() => {
    if (locked) return;
    setPin((prev) => {
      const next = prev.slice(0, -1);
      setStatusText(
        next.length ? `${PIN_LENGTH - next.length} ${t("login.more")}` : t("login.enterYourPin")
      );
      return next;
    });
  }, [locked]);

  const clear = useCallback(() => {
    if (locked) return;
    setPin("");
    setStatusText(t("login.enterYourPin"));
  }, [locked, t]);

  const submit = useCallback(async () => {
    if (locked || pin.length < PIN_LENGTH) return;

    setPhase("loading");
    setStatusText(t("login.verifying"));

    try {
      const response = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? t("login.loginFailed"));
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      });

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      // Success
      setPhase("success");
      setUserName(payload.name ?? "Worker");
      setStatusText("");

      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 2000);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : t("login.loginFailed");
      setPhase("error");
      setStatusText(message);

      setTimeout(() => {
        setPin("");
        setPhase("idle");
        setStatusText(t("login.enterYourPin"));
      }, 1200);
    }
  }, [locked, pin, supabase, router, t]);

  // Keyboard support
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key >= "0" && e.key <= "9") addDigit(e.key);
      else if (e.key === "Backspace") backspace();
      else if (e.key === "Escape") clear();
      else if (e.key === "Enter") submit();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [addDigit, backspace, clear, submit]);

  const dotClass = (i: number) => {
    const filled = i < pin.length;
    if (phase === "success" && filled) return "login-dot filled success-fill";
    if (phase === "error" && filled) return "login-dot filled error-fill";
    if (filled) return "login-dot filled";
    return "login-dot";
  };

  const pinBoxClass = () => {
    let cls = "login-pin-dots";
    if (phase === "success") cls += " success";
    else if (phase === "error") cls += " error";
    else if (pin.length > 0) cls += " focused";
    return cls;
  };

  const signInClass = () => {
    if (phase === "loading") return "login-sign-in loading";
    if (pin.length >= PIN_LENGTH) return "login-sign-in ready";
    return "login-sign-in";
  };

  const statusClass = () => {
    if (phase === "error") return "login-status err";
    if (phase === "success") return "login-status ok";
    return "login-status neutral";
  };

  const now = new Date();
  const h = now.getHours() % 12 || 12;
  const ap = now.getHours() >= 12 ? "PM" : "AM";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stampTime = `${t("login.clockedInAt")} ${h}:${pad(now.getMinutes())} ${ap}`;

  return (
    <>
      <style>{loginStyles}</style>

      <div className="login-body">
        <div className={`login-card${phase === "error" ? "" : ""}`} ref={cardRef}>
          <div className="login-brand">{t("login.brand")}</div>
          <div className="login-title">{t("login.title")}</div>
          <div className="login-clock">{clockText}</div>

          <div className="login-divider" />

          <div className="login-pin-label">{t("login.enterPin")}</div>
          <div className={pinBoxClass()}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <div key={i} className={dotClass(i)} />
            ))}
          </div>

          <div className="login-numpad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
              <button
                key={n}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  addDigit(n);
                }}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="fn-key"
              onPointerDown={(e) => {
                e.preventDefault();
                clear();
              }}
            >
              {t("login.clr")}
            </button>
            <button
              type="button"
              className="zero-key"
              onPointerDown={(e) => {
                e.preventDefault();
                addDigit("0");
              }}
            >
              0
            </button>
            <button
              type="button"
              className="fn-key"
              onPointerDown={(e) => {
                e.preventDefault();
                backspace();
              }}
            >
              <svg viewBox="0 0 24 24">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className={signInClass()}
            disabled={phase === "loading" || pin.length < PIN_LENGTH}
            onPointerDown={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {phase === "loading" ? "\u00B7 \u00B7 \u00B7" : t("login.signIn")}
          </button>

          <div className={statusClass()}>{statusText}</div>

          {/* Success overlay */}
          <div className={`login-overlay${phase === "success" ? " show" : ""}`}>
            <div className="check-circle">
              <svg viewBox="0 0 24 24">
                <polyline points="6 12 10 16 18 8" />
              </svg>
            </div>
            <div className="overlay-name">{t("login.welcome")} {userName}</div>
            <div className="overlay-sub">{t("login.shiftStarted")}</div>
            <div className="overlay-time">{stampTime}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---- Scoped styles (mirrors the HTML prototype, mapped to project design tokens) ---- */

const loginStyles = /* css */ `
  .login-body {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    position: relative;
  }

  /* Subtle radial glow */
  .login-body::before {
    content: '';
    position: fixed;
    inset: 0;
    background:
      radial-gradient(ellipse 70% 35% at 50% -5%, rgba(191, 162, 52, 0.04) 0%, transparent 60%),
      radial-gradient(ellipse 50% 50% at 100% 100%, rgba(30, 35, 41, 0.5) 0%, transparent 50%);
    pointer-events: none;
  }

  /* Grain texture */
  .login-body::after {
    content: '';
    position: fixed;
    inset: 0;
    opacity: 0.018;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 100px 100px;
    pointer-events: none;
  }

  /* Card */
  .login-card {
    position: relative;
    z-index: 1;
    width: 380px;
    padding: 36px 32px 32px;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 16px;
    box-shadow:
      0 20px 50px -10px rgba(0, 0, 0, 0.6),
      0 8px 16px -4px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      inset 0 -1px 0 rgba(0, 0, 0, 0.15);
    animation: loginCardIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes loginCardIn {
    from { opacity: 0; transform: translateY(16px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Yellow top accent line */
  .login-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 32px;
    right: 32px;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--brand-yellow) 25%, var(--brand-gold-light) 50%, var(--brand-yellow) 75%, transparent);
    border-radius: 0 0 2px 2px;
    opacity: 0.7;
  }

  /* Header */
  .login-brand {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2.5px;
    color: var(--brand-yellow);
    text-transform: uppercase;
    margin-bottom: 4px;
    animation: loginFadeUp 0.5s 0.15s both;
  }

  .login-title {
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.3px;
    line-height: 1.15;
    animation: loginFadeUp 0.5s 0.2s both;
  }

  .login-clock {
    font-family: var(--font-mono), monospace;
    font-size: 13px;
    font-weight: 400;
    color: var(--text-muted);
    margin-top: 4px;
    letter-spacing: 0.5px;
    animation: loginFadeUp 0.5s 0.25s both;
  }

  @keyframes loginFadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Divider */
  .login-divider {
    height: 0;
    border-top: 1px solid rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    margin: 24px 0 20px;
    animation: loginFadeUp 0.5s 0.3s both;
  }

  /* PIN section */
  .login-pin-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2px;
    color: var(--text-secondary);
    text-transform: uppercase;
    margin-bottom: 12px;
    animation: loginFadeUp 0.5s 0.32s both;
  }

  .login-pin-dots {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 24px;
    padding: 18px;
    background: var(--bg-primary);
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    margin-bottom: 20px;
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.4),
      inset 0 1px 1px rgba(0, 0, 0, 0.2),
      0 1px 0 rgba(255, 255, 255, 0.03);
    transition: border-color 0.3s, box-shadow 0.3s;
    animation: loginFadeUp 0.5s 0.35s both;
  }

  .login-pin-dots.focused {
    border-color: rgba(191, 162, 52, 0.2);
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.4),
      inset 0 1px 1px rgba(0, 0, 0, 0.2),
      0 0 0 3px rgba(191, 162, 52, 0.10),
      0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .login-pin-dots.error {
    animation: loginShake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97);
    border-color: rgba(212, 81, 94, 0.3);
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.4),
      0 0 0 3px rgba(212, 81, 94, 0.08);
  }

  .login-pin-dots.success {
    border-color: rgba(46, 166, 122, 0.3);
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.4),
      0 0 0 3px rgba(46, 166, 122, 0.08);
  }

  @keyframes loginShake {
    10%, 90% { transform: translateX(-2px); }
    20%, 80% { transform: translateX(3px); }
    30%, 50%, 70% { transform: translateX(-5px); }
    40%, 60% { transform: translateX(5px); }
  }

  /* Dots */
  .login-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--text-muted);
    background: transparent;
    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .login-dot.filled {
    background: var(--brand-yellow);
    border-color: var(--brand-yellow);
    box-shadow: 0 0 10px rgba(191, 162, 52, 0.28);
    transform: scale(1.2);
  }

  .login-dot.success-fill {
    background: var(--green);
    border-color: var(--green);
    box-shadow: 0 0 10px rgba(46, 166, 122, 0.3);
  }

  .login-dot.error-fill {
    background: var(--red);
    border-color: var(--red);
    box-shadow: 0 0 10px rgba(212, 81, 94, 0.3);
  }

  /* Numpad */
  .login-numpad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 16px;
    animation: loginFadeUp 0.5s 0.4s both;
  }

  .login-numpad button {
    font-family: var(--font-sans), sans-serif;
    font-size: 22px;
    font-weight: 600;
    color: var(--text-primary);
    background: linear-gradient(180deg, #252a33 0%, var(--bg-elevated) 100%);
    border: 1px solid var(--border-default);
    border-top-color: #3C4453;
    border-bottom-color: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    padding: 14px;
    cursor: pointer;
    transition: all 0.12s ease;
    position: relative;
    overflow: hidden;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none;
    user-select: none;
    box-shadow:
      0 3px 6px -1px rgba(0, 0, 0, 0.4),
      0 1px 2px rgba(0, 0, 0, 0.25),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .login-numpad button:hover {
    background: linear-gradient(180deg, #2d333d 0%, #2B3139 100%);
    border-color: #3C4453;
    box-shadow:
      0 4px 8px -1px rgba(0, 0, 0, 0.45),
      0 2px 3px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
    transform: translateY(-1px);
  }

  .login-numpad button:active {
    transform: translateY(1px);
    background: linear-gradient(180deg, var(--bg-elevated) 0%, #1a1d24 100%);
    border-color: rgba(0, 0, 0, 0.3);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.3),
      inset 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .login-numpad button.fn-key {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 1px;
    color: var(--text-secondary);
  }

  .login-numpad button.fn-key svg {
    width: 18px;
    height: 18px;
    stroke: var(--text-secondary);
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: stroke 0.15s;
  }

  .login-numpad button.fn-key:hover svg {
    stroke: var(--text-primary);
  }

  .login-numpad button.zero-key {
    grid-column: 2;
  }

  /* Sign In button */
  .login-sign-in {
    width: 100%;
    padding: 14px;
    font-family: var(--font-sans), sans-serif;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: var(--text-muted);
    background: linear-gradient(180deg, #252a33 0%, var(--bg-elevated) 100%);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    cursor: not-allowed;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none;
    user-select: none;
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    animation: loginFadeUp 0.5s 0.45s both;
  }

  .login-sign-in.ready {
    color: var(--text-inverse);
    background: linear-gradient(180deg, var(--brand-gold-light) 0%, var(--brand-yellow) 100%);
    border-color: var(--brand-yellow-active);
    border-top-color: var(--brand-gold-light);
    cursor: pointer;
    font-weight: 700;
    box-shadow:
      0 4px 12px -2px rgba(191, 162, 52, 0.28),
      0 2px 4px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }

  .login-sign-in.ready:hover {
    background: linear-gradient(180deg, #e0c455 0%, var(--brand-gold-light) 100%);
    border-color: var(--brand-yellow);
    box-shadow:
      0 6px 20px -3px rgba(191, 162, 52, 0.28),
      0 3px 6px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.18);
    transform: translateY(-1px);
  }

  .login-sign-in.ready:active {
    transform: translateY(1px);
    background: linear-gradient(180deg, var(--brand-yellow) 0%, var(--brand-yellow-active) 100%);
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.3),
      inset 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .login-sign-in.loading {
    color: var(--brand-yellow);
    background: var(--bg-elevated);
    border-color: rgba(191, 162, 52, 0.2);
    cursor: wait;
  }

  /* Status text */
  .login-status {
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.5px;
    min-height: 18px;
    margin-top: 14px;
    transition: all 0.3s;
    animation: loginFadeUp 0.5s 0.5s both;
  }

  .login-status.neutral { color: var(--text-muted); }
  .login-status.err { color: var(--red); }
  .login-status.ok { color: var(--green); }

  /* Success overlay */
  .login-overlay {
    position: absolute;
    inset: 0;
    background: var(--bg-surface);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.35s;
    z-index: 10;
  }

  .login-overlay.show {
    opacity: 1;
    pointer-events: auto;
  }

  .login-overlay .check-circle {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--green);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
    animation: loginPop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  @keyframes loginPop {
    from { transform: scale(0); }
    to { transform: scale(1); }
  }

  .login-overlay .check-circle svg {
    width: 26px;
    height: 26px;
    stroke: var(--bg-primary);
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 30;
    stroke-dashoffset: 30;
    animation: loginDraw 0.35s 0.25s ease forwards;
  }

  @keyframes loginDraw {
    to { stroke-dashoffset: 0; }
  }

  .login-overlay .overlay-name {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-primary);
    animation: loginFadeUp 0.4s 0.3s both;
  }

  .login-overlay .overlay-sub {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 2px;
    color: var(--green);
    margin-top: 2px;
    text-transform: uppercase;
    animation: loginFadeUp 0.4s 0.4s both;
  }

  .login-overlay .overlay-time {
    font-family: var(--font-mono), monospace;
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 12px;
    animation: loginFadeUp 0.4s 0.5s both;
  }

  /* Mobile fullscreen */
  @media (max-width: 420px) {
    .login-card {
      width: 100%;
      min-height: 100dvh;
      border-radius: 0;
      border: none;
      padding: 32px 20px 20px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .login-card::before { left: 20px; right: 20px; }
    .login-numpad button { padding: 16px; }
  }
`;
