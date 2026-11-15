/** The paw motif (logo, empty states). Own drawing; decorative, so hidden from screen readers. */
export function PawMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="currentColor" aria-hidden="true">
      <ellipse cx="32" cy="43" rx="14" ry="11.5" />
      <ellipse cx="13" cy="29" rx="5.5" ry="7.5" />
      <ellipse cx="25" cy="17" rx="5.5" ry="7.5" />
      <ellipse cx="39" cy="17" rx="5.5" ry="7.5" />
      <ellipse cx="51" cy="29" rx="5.5" ry="7.5" />
    </svg>
  );
}
