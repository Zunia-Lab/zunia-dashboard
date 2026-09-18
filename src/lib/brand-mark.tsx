/** Shared chevron mark for ImageResponse icons and OG cards. */

export const BRAND_BG = "#0B0A09";
export const BRAND_FG = "#F1F0EE";
export const BRAND_MUTED = "#9A948C";

export function BrandMark({
  size = 96,
  color = BRAND_FG,
}: {
  size?: number;
  color?: string;
}) {
  const height = (size * 120) / 96;
  return (
    <svg viewBox="0 0 96 120" width={size} height={height}>
      <defs>
        <mask
          id="zunia-gap"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="96"
          height="120"
        >
          <rect width="96" height="120" fill="#fff" />
          <path
            d="M26 20 L70 46 L26 72"
            fill="none"
            stroke="#000"
            strokeWidth="30"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <g
        mask="url(#zunia-gap)"
        fill="none"
        stroke={color}
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M26 48 L70 74 L26 100" />
      </g>
      <path
        d="M26 20 L70 46 L26 72"
        fill="none"
        stroke={color}
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
