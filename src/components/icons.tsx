import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** Canonical LetsConnect mark — same geometry as /logo.svg (favicon, Android, hero). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ display: 'block', flex: '0 0 auto' }}
    />
  );
}

export function IconMic() {
  return (
    <Svg>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Svg>
  );
}

export function IconMicOff() {
  return (
    <Svg>
      <path d="M9 9v3a3 3 0 0 0 5.1 2.1" />
      <path d="M15 10.5V6a3 3 0 0 0-5.7-1.3" />
      <path d="M5 11a7 7 0 0 0 11.5 5.3" />
      <path d="M12 18v3" />
      <path d="M4 4l16 16" />
    </Svg>
  );
}

export function IconCam() {
  return (
    <Svg>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3z" />
    </Svg>
  );
}

export function IconCamOff() {
  return (
    <Svg>
      <path d="M2 8a2 2 0 0 1 2-2h8" />
      <path d="M16 10l6-3v10l-4-2" />
      <path d="M2 16V8" />
      <path d="M4 18h8" />
      <path d="M4 4l16 16" />
    </Svg>
  );
}

export function IconShare() {
  return (
    <Svg>
      <rect x="3" y="10" width="18" height="10" rx="2" />
      <path d="M12 14V3" />
      <path d="M8 6l4-4 4 4" />
    </Svg>
  );
}

export function IconHand() {
  return (
    <Svg>
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 10.5V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 10.2V6.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M8 11.5c0 4 2 7.5 6.2 7.5 3.4 0 5.8-2.2 5.8-5.5V10" />
      <path d="M8 12c-.8 0-2 .6-2.5 2S6 18 8.5 18" />
    </Svg>
  );
}

export function IconSmile() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14c1.1 1.4 2.4 2 4 2s2.9-.6 4-2" />
      <circle cx="9" cy="10" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconCaptions() {
  return (
    <Svg>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 12h4" />
      <path d="M13 12h4" />
      <path d="M7 15h6" />
    </Svg>
  );
}

export function IconChat() {
  return (
    <Svg>
      <path d="M5 16.5 3 20l4.2-1.6A9 9 0 1 0 5 16.5z" />
    </Svg>
  );
}

export function IconPeople() {
  return (
    <Svg>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.5-3 2.6-4.5 5.5-4.5s5 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M16 14.6c1.8.3 3.2 1.4 3.8 3.4" />
    </Svg>
  );
}

export function IconMore() {
  return (
    <Svg>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconLeave() {
  return (
    <Svg>
      <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" />
      <path d="M15 12H3" />
      <path d="M6 9 3 12l3 3" />
    </Svg>
  );
}

export function IconLook() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M8.2 16.2c.7-1.8 2.1-2.7 3.8-2.7s3.1.9 3.8 2.7" />
    </Svg>
  );
}

export function IconPin() {
  return (
    <Svg>
      <path d="M9 4h6l-1 6 3 2v2H7v-2l3-2z" />
      <path d="M12 14v6" />
    </Svg>
  );
}
