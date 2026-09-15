import * as React from 'react';

/**
 * Alma logo — the EXACT official SVG asset (public/brand/alma-logo.svg),
 * rendered as-is so colors and the embedded gradient artwork are identical
 * to the source file. It sits on the brand-ink tile because the asset is
 * designed for dark surfaces.
 */
export function AlmaLogo({
  height = 26,
  className,
  tileClassName,
}: {
  height?: number;
  className?: string;
  tileClassName?: string;
}) {
  return (
    <span
      aria-label="Alma"
      role="img"
      className={`inline-flex items-center justify-center rounded-xl bg-[var(--brand-ink)] px-2.5 py-2 ${tileClassName ?? ''}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/alma-logo.svg"
        alt=""
        style={{ height }}
        className={className}
        draggable={false}
      />
    </span>
  );
}
