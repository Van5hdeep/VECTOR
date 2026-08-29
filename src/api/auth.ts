import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

export async function verifyPassword(
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return await res.json();
  } catch {
    return { success: false, error: "Unable to reach VECTOR_CORE." };
  }
}

export async function getWebAuthnStatus(): Promise<{ registered: boolean }> {
  try {
    const res = await fetch("/api/auth/webauthn/status");
    return await res.json();
  } catch {
    return { registered: false };
  }
}

export async function registerWebAuthn(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // 1. Get registration options from server
    const optionsRes = await fetch("/api/auth/webauthn/register/options", {
      method: "POST",
    });
    const options = await optionsRes.json();

    // 2. Start registration with platform authenticator (Windows Hello)
    const regResponse = await startRegistration({ optionsJSON: options });

    // 3. Send response to server for verification
    const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(regResponse),
    });
    return await verifyRes.json();
  } catch (err: any) {
    // User cancelled or platform authenticator not available
    if (err?.name === "NotAllowedError") {
      return { success: false, error: "Authentication was cancelled." };
    }
    if (err?.name === "NotSupportedError") {
      return {
        success: false,
        error: "Windows Hello is not available on this device.",
      };
    }
    return {
      success: false,
      error: err?.message || "Windows Hello registration failed.",
    };
  }
}

export async function authenticateWebAuthn(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // 1. Get authentication options from server
    const optionsRes = await fetch(
      "/api/auth/webauthn/authenticate/options",
      { method: "POST" }
    );
    const options = await optionsRes.json();

    // 2. Start authentication with platform authenticator (Windows Hello)
    const authResponse = await startAuthentication({ optionsJSON: options });

    // 3. Send response to server for verification
    const verifyRes = await fetch(
      "/api/auth/webauthn/authenticate/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResponse),
      }
    );
    return await verifyRes.json();
  } catch (err: any) {
    if (err?.name === "NotAllowedError") {
      return { success: false, error: "Authentication was cancelled." };
    }
    return {
      success: false,
      error: err?.message || "Windows Hello authentication failed.",
    };
  }
}
