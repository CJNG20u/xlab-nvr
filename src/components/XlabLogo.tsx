interface XlabLogoProps {
  className?: string;
}

export function XlabLogo({ className = 'w-8 h-8' }: XlabLogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="xlab-ring" x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="xlab-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#151c28" />
          <stop offset="100%" stopColor="#0c1118" />
        </linearGradient>
      </defs>

      {/* Dark geometric housing */}
      <rect
        x="1.5"
        y="1.5"
        width="37"
        height="37"
        rx="9"
        fill="url(#xlab-bg)"
        stroke="#334155"
        strokeOpacity="0.65"
        strokeWidth="1.25"
      />

      {/* Camera lens aperture outer ring */}
      <circle
        cx="20"
        cy="20"
        r="12"
        stroke="#475569"
        strokeOpacity="0.6"
        strokeWidth="1.25"
      />

      {/* Segmented aperture arcs */}
      <path
        d="M11.8 11.8 A11.6 11.6 0 0 1 25.4 9.7"
        stroke="url(#xlab-ring)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M28.2 28.2 A11.6 11.6 0 0 1 14.6 30.3"
        stroke="url(#xlab-ring)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />

      {/* Angular X reticle strokes */}
      <path
        d="M13 13 L17.6 17.6 M27 27 L22.4 22.4 M27 13 L22.4 17.6 M13 27 L17.6 22.4"
        stroke="#e2e8f0"
        strokeWidth="2.1"
        strokeLinecap="square"
      />

      {/* Inner lens aperture core */}
      <circle
        cx="20"
        cy="20"
        r="3.1"
        fill="#0f172a"
        stroke="url(#xlab-ring)"
        strokeWidth="1.5"
      />

      {/* Subtle recording dot accent */}
      <circle cx="31.5" cy="8.5" r="2.3" fill="#10b981" />
    </svg>
  );
}
