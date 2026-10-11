import { useEffect, useRef, useState, type FormEvent } from "react";
import { verifyPassword, getWebAuthnStatus, registerWebAuthn, authenticateWebAuthn } from "../../api/auth";
import Icon from "../ui/Icon";

interface AuthPanelProps {
  onSuccess: () => void;
  onFailure: () => void;
}

export default function AuthPanel({ onSuccess, onFailure }: AuthPanelProps) {
  const [method, setMethod] = useState<"password" | "hello">("password");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [helloRegistered, setHelloRegistered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getWebAuthnStatus().then((s) => setHelloRegistered(s.registered));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [method]);

  const fail = (message: string) => {
    // Keep the server's lockout countdown; otherwise say plainly what to do
    setError(/too many/i.test(message) ? message : message === "Authentication failed." ? "That password isn't right. Try again." : message);
    setPassword("");
    onFailure();
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    const result = await verifyPassword(password);
    setBusy(false);
    if (result.success) onSuccess();
    else fail(result.error || "That password isn't right. Try again.");
  };

  const useHello = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    if (!helloRegistered) {
      // First-time setup: the password proves ownership, then this device is registered
      if (!password) {
        setBusy(false);
        setError("Enter your password once to set up Windows Hello.");
        return;
      }
      const passwordResult = await verifyPassword(password);
      if (!passwordResult.success) {
        setBusy(false);
        fail(passwordResult.error || "That password isn't right. Try again.");
        return;
      }
      const registration = await registerWebAuthn();
      setBusy(false);
      if (registration.success) setHelloRegistered(true);
      onSuccess();
      return;
    }

    const result = await authenticateWebAuthn();
    setBusy(false);
    if (result.success) onSuccess();
    else fail(result.error || "Windows Hello didn't verify you. Try again or use your password.");
  };

  return (
    <div className="auth" role="dialog" aria-label="Unlock VECTOR">
      <div className="auth__tabs" role="tablist">
        <button
          role="tab"
          aria-selected={method === "password"}
          className={`auth__tab ${method === "password" ? "auth__tab--active" : ""}`}
          onClick={() => { setMethod("password"); setError(""); }}
        >
          <Icon name="lock" size={15} /> Password
        </button>
        <button
          role="tab"
          aria-selected={method === "hello"}
          className={`auth__tab ${method === "hello" ? "auth__tab--active" : ""}`}
          onClick={() => { setMethod("hello"); setError(""); }}
        >
          <Icon name="fingerprint" size={15} /> Windows Hello
        </button>
      </div>

      {method === "password" ? (
        <form className="auth__row" onSubmit={submitPassword}>
          <input
            ref={inputRef}
            className="field"
            type="password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
          <button className="btn btn--primary" type="submit" disabled={busy || !password}>
            {busy ? "Verifying…" : "Unlock"}
          </button>
        </form>
      ) : (
        <form className="auth__row" onSubmit={useHello} style={{ flexDirection: "column" }}>
          <p className="auth__hint">
            {helloRegistered
              ? "Verify with your face, fingerprint or PIN."
              : "First time on this device: confirm your password, then Windows Hello will be set up."}
          </p>
          {!helloRegistered && (
            <input
              ref={inputRef}
              className="field"
              type="password"
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          )}
          <button className="btn btn--primary" type="submit" disabled={busy}>
            <Icon name="fingerprint" size={16} />
            {busy ? "Waiting for Windows Hello…" : helloRegistered ? "Verify with Windows Hello" : "Set up and unlock"}
          </button>
        </form>
      )}

      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
