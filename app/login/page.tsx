"use client";

import { FormEvent, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { enfyraConfig } from "@/lib/enfyra-config";
import { loginWithPassword } from "@/lib/enfyra-api";

export default function LoginPage() {
  const [email, setEmail] = useState("dothinh115@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await loginWithPassword(email, password);
      window.location.href = "/chat";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function googleLogin() {
    const redirect = new URL("/chat", window.location.origin);
    const oauthUrl = new URL("/api/auth/google", enfyraConfig.enfyraAppUrl);
    oauthUrl.searchParams.set("redirect", redirect.toString());
    oauthUrl.searchParams.set("cookieBridgePrefix", enfyraConfig.apiProxyPrefix);
    window.location.href = oauthUrl.toString();
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-block">
          <span className="brand-mark">
            <MessageSquareText size={22} />
          </span>
          <div>
            <p>Powered by Enfyra</p>
            <h1>Next Chat</h1>
          </div>
        </div>
        <p className="muted">
          Same Enfyra auth, REST proxy, cookie bridge, and Socket.IO config as the Nuxt demo.
        </p>
        <form onSubmit={submit} className="login-form">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <button className="secondary-button" type="button" onClick={googleLogin}>
          Continue with Google through Enfyra
        </button>
      </section>
    </main>
  );
}
