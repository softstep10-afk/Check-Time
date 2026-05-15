"use client";

import { useId } from "react";

export type JarvisOrbState =
  | "idle"
  | "listening"
  | "speaking"
  | "thinking"
  | "notification"
  | "error";

type JarvisOrbSize = "xs" | "sm" | "md" | "lg";

const sizeClass: Record<JarvisOrbSize, string> = {
  xs: "h-6 w-6",
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
};

export function JarvisOrb({
  state = "idle",
  size = "md",
  className = "",
  label = "Jarvis",
}: {
  state?: JarvisOrbState;
  size?: JarvisOrbSize;
  className?: string;
  label?: string;
}) {
  const id = useId().replace(/:/g, "");

  return (
    <span
      className={`jarvis-orb ${sizeClass[size]} ${className}`}
      data-state={state}
      aria-label={label}
      role="img"
    >
      <svg className="jarvis-orb__svg" viewBox="0 0 96 96" aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-core`} cx="50%" cy="50%" r="58%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="14%" stopColor="#c9fbff" />
            <stop offset="34%" stopColor="#4de5ff" />
            <stop offset="62%" stopColor="#0b6ea4" />
            <stop offset="100%" stopColor="#020a14" />
          </radialGradient>
          <linearGradient id={`${id}-steel`} x1="12" x2="84" y1="10" y2="86">
            <stop offset="0%" stopColor="#f8fdff" />
            <stop offset="20%" stopColor="#9edff2" />
            <stop offset="46%" stopColor="#081827" />
            <stop offset="72%" stopColor="#62dfff" />
            <stop offset="100%" stopColor="#eefbff" />
          </linearGradient>
          <linearGradient id={`${id}-deep`} x1="20" x2="76" y1="16" y2="82">
            <stop offset="0%" stopColor="#12283d" />
            <stop offset="52%" stopColor="#020713" />
            <stop offset="100%" stopColor="#0b3858" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle className="jarvis-orb__halo" cx="48" cy="48" r="45" />
        <line className="jarvis-orb__axis" x1="0" x2="19" y1="48" y2="48" />
        <line className="jarvis-orb__axis" x1="77" x2="96" y1="48" y2="48" />
        <line className="jarvis-orb__axis jarvis-orb__axis--soft" x1="48" x2="48" y1="0" y2="17" />
        <line className="jarvis-orb__axis jarvis-orb__axis--soft" x1="48" x2="48" y1="79" y2="96" />

        <g className="jarvis-orb__outer">
          <circle
            cx="48"
            cy="48"
            r="42"
            fill="none"
            stroke={`url(#${id}-steel)`}
            strokeLinecap="round"
            strokeWidth="5"
            strokeDasharray="34 11 8 15 23 10"
          />
        </g>
        <g className="jarvis-orb__outer jarvis-orb__outer--counter">
          <circle
            cx="48"
            cy="48"
            r="36"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeOpacity="0.78"
            strokeWidth="1.8"
            strokeDasharray="2 4"
          />
        </g>

        <circle className="jarvis-orb__plate" cx="48" cy="48" r="29" fill={`url(#${id}-deep)`} />
        <path
          className="jarvis-orb__segments"
          d="M30 30a25 25 0 0 1 36 0M66 66a25 25 0 0 1-36 0M25 48a23 23 0 0 1 3-11M71 37a23 23 0 0 1 3 11M28 60a23 23 0 0 1-3-10M74 50a23 23 0 0 1-3 10"
        />
        <g className="jarvis-orb__scan">
          <circle cx="48" cy="48" r="23" fill="none" stroke="currentColor" strokeOpacity="0.34" strokeWidth="1" />
          <path d="M48 25v7M48 64v7M25 48h7M64 48h7" stroke="currentColor" strokeLinecap="round" strokeOpacity="0.42" />
        </g>

        <path
          className="jarvis-orb__hex"
          d="M48 31.5 62.7 40v16L48 64.5 33.3 56V40Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
        />
        <path
          className="jarvis-orb__hex jarvis-orb__hex--inner"
          d="M48 38 56.8 43v10L48 58l-8.8-5V43Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle className="jarvis-orb__core" cx="48" cy="48" r="9" fill={`url(#${id}-core)`} filter={`url(#${id}-glow)`} />
      </svg>
    </span>
  );
}
