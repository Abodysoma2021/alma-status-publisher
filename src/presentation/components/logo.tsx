import * as React from 'react';
import { AlmaWordmark } from './logo-wordmark';

/**
 * Alma logo. The original asset is white — it always sits on a dark
 * "brand ink" tile so it renders correctly in both themes without
 * recoloring the embedded gradient artwork.
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
      <AlmaWordmark height={height} className={`text-white ${className ?? ''}`} />
    </span>
  );
}
