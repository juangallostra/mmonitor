import { AUTH } from "./credentials.js";
import encryptedProjects from "../data/projects.enc.json";
import {
  hashPassword,
  deriveEncryptionKey,
  exportKey,
  importKey,
  decryptJSON,
  encryptJSON,
  safeEqual,
} from "./crypto.js";

// La clave de descifrado vive en sessionStorage: sobrevive a recargas, pero
// se pierde al cerrar la pestaña, que equivale a cerrar sesión.
const SESSION_KEY = "mmonitor_session_v1";
const LOCAL_PROJECTS_KEY = "mmonitor_projects_v2";
const LEGACY_PROJECTS_KEY = "mmonitor_projects_v1";

const DEFAULT_BASE_URL = "https://saas.manttest.net";

export const isConfigured = Boolean(AUTH);

function normalizeJsonProject(p) {
  return {
    id: `json-${p.proyecto}`,
    source: "json",
    name: p.nombre || p.proyecto,
    baseUrl: p.url || `${DEFAULT_BASE_URL}/${p.proyecto}`,
    projectCode: p.proyecto,
    username: p.usuario,
    password: p.contraseña,
  };
}

async function openSession(key) {
  const list = encryptedProjects ? await decryptJSON(key, encryptedProjects) : [];
  return {
    username: AUTH.username,
    key,
    jsonProjects: list.map(normalizeJsonProject),
  };
}

export async function login(username, password) {
  if (!AUTH) throw new Error("La app no está configurada.");
  const hash = await hashPassword(password, AUTH.hashSalt, AUTH.iterations);
  const userOk = safeEqual(username.trim(), AUTH.username);
  if (!safeEqual(hash, AUTH.passwordHash) || !userOk) {
    throw new Error("Usuario o contraseña incorrectos.");
  }
  const key = await deriveEncryptionKey(password, AUTH.keySalt, AUTH.iterations);
  let session;
  try {
    session = await openSession(key);
  } catch (e) {
    throw new Error(
      "La contraseña es correcta pero no descifra projects.enc.json. Vuelve a ejecutar `npm run secrets`."
    );
  }
  try {
    sessionStorage.setItem(SESSION_KEY, await exportKey(key));
  } catch (e) {
    /* sin sessionStorage: la sesión dura hasta recargar */
  }
  return session;
}

export async function restoreSession() {
  if (!AUTH) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return await openSession(await importKey(raw));
  } catch (e) {
    logout();
    return null;
  }
}

export function logout() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    /* nada que limpiar */
  }
}

// Proyectos añadidos desde la interfaz: se guardan cifrados (contraseña
// incluida) con la misma clave de sesión.
export async function loadLocalProjects(key) {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    if (raw) {
      const list = await decryptJSON(key, JSON.parse(raw));
      return Array.isArray(list) ? list.map((p) => ({ ...p, source: "local" })) : [];
    }
    // Migración desde la versión anterior (sin cifrar y sin contraseñas).
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PROJECTS_KEY) || "[]");
    return Array.isArray(legacy)
      ? legacy.map((p) => ({ ...p, password: p.password || "", source: "local" }))
      : [];
  } catch (e) {
    // Cifrados con una contraseña anterior: no se pueden recuperar.
    return [];
  }
}

export async function saveLocalProjects(key, projects) {
  try {
    const payload = await encryptJSON(key, projects);
    localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(payload));
    localStorage.removeItem(LEGACY_PROJECTS_KEY);
  } catch (e) {
    /* sin localStorage: los proyectos locales solo duran esta sesión */
  }
}
