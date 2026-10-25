import React, { useEffect, useState } from "react";
import App from "./App.jsx";
import LoginScreen from "./LoginScreen.jsx";
import { logout, restoreSession } from "./auth/session.js";

export default function Root() {
  const [session, setSession] = useState(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    restoreSession().then((s) => {
      setSession(s);
      setRestoring(false);
    });
  }, []);

  if (restoring) return null;
  if (!session) return <LoginScreen onLogin={setSession} />;

  return (
    <App
      session={session}
      onLogout={() => {
        logout();
        setSession(null);
      }}
    />
  );
}
