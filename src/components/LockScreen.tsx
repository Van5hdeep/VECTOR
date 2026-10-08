import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  verifyPassword,
  getWebAuthnStatus,
  registerWebAuthn,
  authenticateWebAuthn,
} from "../api/auth";

interface LockScreenProps {
  onUnlock: () => void;
  isUnlocking: boolean;
}

const LockScreen = ({ onUnlock, isUnlocking }: LockScreenProps) => {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMethod, setAuthMethod] = useState<"password" | "webauthn">("password");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [webauthnRegistered, setWebauthnRegistered] = useState(false);

  // Entrance animation states
  const [showTitle, setShowTitle] = useState(false);
  const [showButton, setShowButton] = useState(false);

  // Entrance sequence
  useEffect(() => {
    const t2 = setTimeout(() => setShowTitle(true), 100);
    const t3 = setTimeout(() => setShowButton(true), 500);
    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // Check WebAuthn status on mount
  useEffect(() => {
    getWebAuthnStatus().then((status) => {
      setWebauthnRegistered(status.registered);
    });
  }, []);

  const handleSuccess = useCallback(() => {
    onUnlock();
  }, [onUnlock]);

  const handlePasswordSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!password.trim() || isAuthenticating) return;

      setIsAuthenticating(true);
      setError("");

      const result = await verifyPassword(password);

      if (result.success) {
        handleSuccess();
      } else {
        setError(result.error || "Authentication failed.");
        setPassword("");
      }
      setIsAuthenticating(false);
    },
    [password, isAuthenticating, handleSuccess]
  );

  const handleWebAuthn = useCallback(async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setError("");

    if (!webauthnRegistered) {
      // First time: prove ownership with the password, then register this device
      if (!password.trim()) {
        setError("Enter your password to set up Windows Hello.");
        setIsAuthenticating(false);
        return;
      }
      const passwordResult = await verifyPassword(password);
      setPassword("");
      if (!passwordResult.success) {
        setError(passwordResult.error || "Authentication failed.");
        setIsAuthenticating(false);
        return;
      }
      const result = await registerWebAuthn();
      if (result.success) {
        setWebauthnRegistered(true);
      } else {
        setError(`${result.error || "Registration failed."} Unlocking with password.`);
      }
      // Password already authenticated this session
      handleSuccess();
    } else {
      // Already registered: authenticate
      const result = await authenticateWebAuthn();
      if (result.success) {
        handleSuccess();
      } else {
        setError(result.error || "Authentication failed.");
      }
    }
    setIsAuthenticating(false);
  }, [isAuthenticating, webauthnRegistered, password, handleSuccess]);

  // Keyboard handler: Escape to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showAuthModal) {
        setShowAuthModal(false);
        setError("");
        setPassword("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAuthModal]);

  return (
    <div className="lock-screen-overlay">
      {/* SYSTEM LOCKED text */}
      <div className={`lock-screen__title ${showTitle && !isUnlocking ? "lock-screen__title--visible" : ""}`}>
        SYSTEM LOCKED
      </div>

      <div className={`lock-screen__title lock-screen__title--success ${isUnlocking ? "lock-screen__title--success-visible" : ""}`}>
        AUTHENTICATION SUCCESSFUL
      </div>

      {/* AUTHENTICATE button */}
      {!showAuthModal && (
        <button
          className={`lock-screen__auth-btn ${showButton && !isUnlocking ? "lock-screen__auth-btn--visible" : ""}`}
          onClick={() => {
            setShowAuthModal(true);
            setError("");
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          AUTHENTICATE
        </button>
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <div className={`lock-screen__modal ${isUnlocking ? "lock-screen__modal--fade-out" : ""}`}>
          <div className="lock-screen__modal-header">
            <span className="lock-screen__modal-title">AUTHENTICATE</span>
            <button
              className="lock-screen__modal-close"
              onClick={() => {
                setShowAuthModal(false);
                setError("");
                setPassword("");
              }}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" />
                <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>

          {/* Method tabs */}
          <div className="lock-screen__methods">
            <button
              className={`lock-screen__method-btn ${authMethod === "password" ? "lock-screen__method-btn--active" : ""}`}
              onClick={() => {
                setAuthMethod("password");
                setError("");
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              PASSWORD
            </button>
            <button
              className={`lock-screen__method-btn ${authMethod === "webauthn" ? "lock-screen__method-btn--active" : ""}`}
              onClick={() => {
                setAuthMethod("webauthn");
                setError("");
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
                <circle cx="12" cy="15" r="2" />
              </svg>
              WINDOWS HELLO
            </button>
          </div>

          {/* Password form */}
          {authMethod === "password" && (
            <form className="lock-screen__form" onSubmit={handlePasswordSubmit}>
              <input
                className="lock-screen__input"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={isAuthenticating}
              />
              <button
                className="lock-screen__submit"
                type="submit"
                disabled={isAuthenticating || !password.trim()}
              >
                {isAuthenticating ? "VERIFYING..." : "UNLOCK"}
              </button>
            </form>
          )}

          {/* Windows Hello */}
          {authMethod === "webauthn" && (
            <div className="lock-screen__webauthn">
              <p className="lock-screen__webauthn-info">
                {webauthnRegistered
                  ? "Authenticate using Windows Hello."
                  : "Set up Windows Hello for VECTOR. Confirm your password to register this device."}
              </p>
              {!webauthnRegistered && (
                <input
                  className="lock-screen__input"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleWebAuthn();
                  }}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isAuthenticating}
                />
              )}
              <button
                className="lock-screen__submit"
                onClick={handleWebAuthn}
                disabled={isAuthenticating}
              >
                {isAuthenticating
                  ? "AUTHENTICATING..."
                  : webauthnRegistered
                    ? "AUTHENTICATE"
                    : "REGISTER & AUTHENTICATE"}
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="lock-screen__error">
              <span className="lock-screen__error-icon">⚠</span>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LockScreen;
