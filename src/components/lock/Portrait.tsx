import { useEffect, useState } from "react";
import { portrait, PORTRAIT_SRC } from "../../lib/portrait";

interface PortraitProps {
  /** Red while locked, blue once the user is verified (crossfades) */
  online: boolean;
  scanning: boolean;
  className?: string;
}

/** VECTOR's full portrait: red-eyed while locked, blue once he wakes. */
export default function Portrait({ online, scanning, className = "" }: PortraitProps) {
  const [blueSrc, setBlueSrc] = useState<string | null>(null);

  // Prepare the blue version up front so the switch is instant
  useEffect(() => {
    portrait("blue").then(setBlueSrc).catch(() => {});
  }, []);

  return (
    <div className={`portrait ${online ? "portrait--online" : ""} ${className}`} role="img" aria-label={online ? "VECTOR is online" : "VECTOR is locked"}>
      <img className="portrait__img portrait__img--red" src={PORTRAIT_SRC} alt="" draggable={false} />
      {blueSrc && <img className="portrait__img portrait__img--blue" src={blueSrc} alt="" draggable={false} />}
      {scanning && <span className="portrait__scan" />}
    </div>
  );
}
