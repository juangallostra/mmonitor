import React, { useState } from "react";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { isConfigured, login } from "./auth/session.js";

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await login(username, password));
    } catch (err) {
      setError(err.message || "No se pudo iniciar sesión.");
      setBusy(false);
    }
  };

  return (
    <div className="mum-login">
      <style>{`
        .mum-login {
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          background: #10141b;
          color: #edeff3;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .mum-login-card {
          width: 100%; max-width: 360px;
          background: #1a2029;
          border: 1px solid #2b3342;
          border-radius: 12px;
          padding: 26px;
        }
        .mum-login-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase;
          color: #5c6577;
          display: flex; align-items: center; gap: 6px;
        }
        .mum-login-title { font-size: 20px; font-weight: 700; margin: 4px 0 20px 0; }
        .mum-login-label {
          display: block; font-size: 11.5px; color: #939cac;
          margin-bottom: 5px; font-weight: 500;
        }
        .mum-login-field { margin-bottom: 14px; }
        .mum-login-wrap { position: relative; }
        .mum-login-input {
          width: 100%;
          background: #212836;
          border: 1px solid #2b3342;
          border-radius: 7px;
          padding: 10px 36px 10px 10px;
          color: #edeff3;
          font-size: 13.5px;
          font-family: inherit;
        }
        .mum-login-input:focus { outline: none; border-color: #4fd8c4; }
        .mum-login-toggle {
          position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
          background: none; border: none; color: #5c6577; cursor: pointer;
          padding: 4px; display: flex; border-radius: 5px;
        }
        .mum-login-toggle:hover { color: #edeff3; }
        .mum-login-btn {
          width: 100%;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          background: #4fd8c4; border: 1px solid #4fd8c4; color: #0a1310;
          font-weight: 600; font-size: 13.5px;
          border-radius: 8px; padding: 10px 14px; cursor: pointer; margin-top: 6px;
        }
        .mum-login-btn:hover { background: #63e0cd; }
        .mum-login-btn:disabled { opacity: 0.6; cursor: wait; }
        .mum-login-error {
          background: rgba(242,102,139,0.08);
          border: 1px solid rgba(242,102,139,0.35);
          color: #f2668b;
          font-size: 12px; border-radius: 7px; padding: 8px 10px; margin-bottom: 14px;
          line-height: 1.4;
        }
        .mum-login-setup { font-size: 13px; color: #939cac; line-height: 1.55; }
        .mum-login-setup code {
          font-family: 'IBM Plex Mono', monospace; font-size: 12px;
          background: #212836; border-radius: 4px; padding: 1px 5px; color: #4fd8c4;
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <div className="mum-login-card">
        <div className="mum-login-eyebrow">
          <Lock size={11} /> manttest · acceso restringido
        </div>
        <h1 className="mum-login-title">Monitor de uso</h1>

        {!isConfigured ? (
          <div className="mum-login-setup">
            La app todavía no tiene usuario configurado. Copia{" "}
            <code>projects.example.json</code> a <code>projects.json</code>, rellénalo y ejecuta{" "}
            <code>npm run secrets</code>.
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="mum-login-error">{error}</div>}
            <div className="mum-login-field">
              <label className="mum-login-label" htmlFor="mum-user">
                Usuario
              </label>
              <input
                id="mum-user"
                className="mum-login-input"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="mum-login-field">
              <label className="mum-login-label" htmlFor="mum-pass">
                Contraseña
              </label>
              <div className="mum-login-wrap">
                <input
                  id="mum-pass"
                  className="mum-login-input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="mum-login-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <button className="mum-login-btn" type="submit" disabled={busy || !password}>
              {busy ? (
                <>
                  <Loader2 size={14} style={{ animation: "spin 0.8s linear infinite" }} /> Comprobando…
                </>
              ) : (
                "Entrar"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
