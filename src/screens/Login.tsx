import { useState } from "react";
import { backend } from "../lib/backend";
import { Orb } from "../components/Orb";
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

  return (
    <main className="screen login">
      <div className="login-orb">
        <Orb colors={palette.orb} size={168} speed={palette.speed} seed={palette.seed} state={busy ? "thinking" : "idle"} />
      </div>
      <h1 className="title">{mode === "login" ? "Willkommen zurück" : "Schön, dass du da bist"}</h1>
      <p className="subtitle">{mode === "login" ? "Melde dich an, um weiterzumachen." : "Erstelle dein Konto. Danach lernen wir uns kennen."}</p>

      <form className="card form" onSubmit={submit}>
        <label>
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
        <label>
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
          <label>
            <span>Passwort wiederholen</span>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? "Einen Moment …" : mode === "login" ? "Anmelden" : "Konto erstellen"}
        </button>
      </form>

      <button
        className="link"
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setError(null);
        }}
      >
        {mode === "login" ? "Neu hier? Konto erstellen" : "Ich habe schon ein Konto"}
      </button>

      {backend.kind === "demo" && (
        <p className="demo-note">Demo-Modus: noch ohne echte KI, alles bleibt auf diesem Gerät.</p>
      )}
    </main>
  );
}
