import { REACTOR_CORE, reactorMarkup, type ReactorTone } from "../lib/reactor";

interface ArcReactorProps {
  /** Blue while VECTOR is responding, red when he isn't */
  tone?: ReactorTone;
  /** Rendered size in CSS pixels (square) */
  size?: number;
  className?: string;
}

/** VECTOR's mark: a glowing triangular arc reactor. */
export default function ArcReactor({ tone = "active", size = 34, className = "" }: ArcReactorProps) {
  return (
    <svg
      className={`reactor reactor--${tone} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: reactorMarkup("currentColor", REACTOR_CORE[tone]) }}
    />
  );
}
