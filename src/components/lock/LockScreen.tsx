import { useEffect, useRef, useState } from "react";
import Portrait from "./Portrait";
import AuthPanel from "./AuthPanel";
import Icon from "../ui/Icon";

/** locked → welcome (eyes turn blue, greeting) → lights (the room lights up into the console) */
export type LockStage = "locked" | "welcome" | "lights";

interface LockScreenProps {
  stage: LockStage;
  onAuthenticated: () => void;
}

export default function LockScreen({ stage, onAuthenticated }: LockScreenProps) {
  const [showAuth, setShowAuth] = useState(false);
  const [denied, setDenied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stage !== "locked") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !showAuth) setShowAuth(true);
      if (e.key === "Escape") setShowAuth(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, showAuth]);

  const handleFailure = () => {
    setDenied(false);
    requestAnimationFrame(() => setDenied(true));
  };

  const locked = stage === "locked";
  const classes = [
    "lock",
    denied && locked ? "lock--denied" : "",
    stage !== "locked" ? "lock--welcome" : "",
    stage === "lights" ? "lock--lights" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} ref={wrapRef} onAnimationEnd={() => setDenied(false)}>
      <header className="lock__bar">
        <span className="lock__wordmark">VECTOR</span>
        <span className="lock__status">
          <span className={`dot ${locked ? "dot--bad" : "dot--ok"}`} />
          {locked ? "Locked" : "Verified"}
        </span>
      </header>

      <main className="lock__center">
        <Portrait className="lock__face" online={!locked} scanning={locked} />

        <div className="lock__content">
        <h1 className="lock__title">System locked</h1>
        <p className="lock__subtitle">Verify it's you to wake VECTOR.</p>

        {showAuth ? (
          <AuthPanel onSuccess={onAuthenticated} onFailure={handleFailure} />
        ) : (
          <button className="btn btn--primary lock__auth-btn" onClick={() => setShowAuth(true)} autoFocus>
            <Icon name="power" size={16} /> Authenticate
          </button>
        )}
        </div>
      </main>

      <div className="lock__light" aria-hidden="true" />

      {stage !== "locked" && (
        <div className="welcome" aria-live="polite">
          <div className="welcome__line">WELCOME BACK</div>
          <div className="welcome__sub">All systems online</div>
        </div>
      )}
    </div>
  );
}
