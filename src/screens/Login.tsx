import { useState } from "react";
import { backend } from "../lib/backend";
import { Portal } from "../components/Portal";
import type { Palette } from "../lib/palette";

export function Login({ palette }: { palette: Palette }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password !== password2) {
      setError("Die beiden Passwörter sind nicht gleich.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") await backend.signUp(username, password);
      else await backend.signIn(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError(null);
  };

  return (
    <main className="screen login">
      <div className="login-portal">
        <Portal colors={palette.orb} daylight={palette.daylight} clouds={palette.clouds} size={230} speed={palette.speed} seed={palette.seed} state={busy ? "thinking" : "idle"} />
      </div>
      <span className="pill">{mode === "login" ? "Willkommen" : "Neu hier"}</span>
      <h1 className="title">{mode === "login" ? "Schön, dass du zurück bist" : "Lass uns anfangen"}</h1>
      <p className="lede">{mode === "login" ? "Melde dich an, um weiterzumachen." : "Erstelle dein Konto. Danach lernen wir uns kennen."}</p>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Benutzername</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span>Passwort</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
          />
        </label>
        {mode === "signup" && (
          <label className="field">
            <span>Passwort wiederholen</span>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dock login-dock">
          <button type="submit" className="dock-main" disabled={busy} aria-label={mode === "login" ? "Anmelden" : "Konto erstellen"}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
          <button type="button" className="dock-pill as-button" onClick={toggle}>
            <span>{mode === "login" ? "Neu hier? Konto erstellen" : "Ich habe schon ein Konto"}</span>
            <span className="dock-chevrons" aria-hidden="true">›››</span>
          </button>
        </div>
      </form>

      {backend.kind === "demo" && <p className="demo-note">Demo-Modus: noch ohne echte KI, alles bleibt auf diesem Gerät.</p>}
    </main>
  );
}
