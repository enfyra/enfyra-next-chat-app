"use client";

import { FormEvent, useEffect, useState } from "react";
import { DatabaseZap, LockKeyhole, MessageSquareText, Network, RadioTower } from "lucide-react";
import { Alert, Badge, Button, Card, PasswordInput, TextInput } from "@mantine/core";
import { enfyraConfig } from "@/lib/enfyra-config";
import { loginWithPassword } from "@/lib/enfyra-api";
import { useAuthStore } from "@/lib/auth-store";

export default function LoginPage() {
  const [email, setEmail] = useState("dothinh115@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const status = useAuthStore((state) => state.status);
  const setAuthUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    if (status === "authenticated") window.location.replace("/chat");
  }, [status]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await loginWithPassword(email, password);
      setAuthUser(user);
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

  if (status === "loading" || status === "authenticated") return null;

  return (
    <main className="page-shell login-page">
      <div className="app-grid-bg" />
      <header className="login-header app-shell-container">
        <a className="brand" href="/chat">
          <span className="brand-mark"><MessageSquareText size={19} /></span>
          <span>Enfyra Next Chat</span>
          <span className="brand-powered">Powered by Enfyra</span>
        </a>
      </header>
      <section className="login-shell">
        <Card className="login-card" withBorder shadow="xl" radius="xl" padding={0}>
          <aside className="login-product-panel">
            <div className="login-copy">
              <Badge color="blue" variant="light" w="fit-content">Powered by Enfyra</Badge>
              <h1>Enfyra Next Chat</h1>
              <p className="muted">
                A third-party Next app using Enfyra for auth, REST data, cookie refresh, and realtime Socket.IO.
              </p>
            </div>
            <div className="login-feature-list">
              <span><LockKeyhole size={17} /> Auth and OAuth cookie bridge</span>
              <span><DatabaseZap size={17} /> REST API through the app proxy</span>
              <span><RadioTower size={17} /> Realtime chat over Socket.IO</span>
            </div>
          </aside>
          <form onSubmit={submit} className="login-form">
            <div className="login-form-heading">
              <h2>Sign in</h2>
              <p>Use the demo account or continue with Google.</p>
            </div>
            <TextInput
              label="Email"
              size="md"
              variant="filled"
              placeholder="Email address"
              classNames={{ input: "login-control-input", label: "login-control-label" }}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              type="email"
              autoComplete="email"
            />
            <PasswordInput
              label="Password"
              size="md"
              variant="filled"
              classNames={{ input: "login-control-input", label: "login-control-label" }}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="current-password"
              placeholder="Enter password"
            />
            {error ? <Alert color="red" variant="light">{error}</Alert> : null}
            <Button className="login-action-button login-primary-action" size="md" type="submit" loading={loading} leftSection={<LockKeyhole size={18} />}>
              {loading ? "Working..." : "Continue"}
            </Button>
            <Button
              className="login-action-button google-button"
              size="md"
              color="gray"
              variant="outline"
              type="button"
              onClick={googleLogin}
              disabled={loading}
              leftSection={<span className="google-mark" aria-hidden="true">G</span>}
            >
              Continue with Google
            </Button>
            <div className="login-note">
              <Network size={16} />
              <span>Enfyra powers the session, data API, and realtime socket behind this Next chat app.</span>
            </div>
          </form>
        </Card>
      </section>
    </main>
  );
}
