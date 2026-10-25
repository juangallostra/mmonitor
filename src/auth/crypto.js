// Utilidades de Web Crypto compartidas entre el navegador y el script
// scripts/secrets.mjs. Solo usan APIs estándar (crypto.subtle, btoa/atob,
// TextEncoder) para funcionar igual en ambos entornos.

export const PBKDF2_ITERATIONS = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomB64(length) {
  return toB64(crypto.getRandomValues(new Uint8Array(length)));
}

async function passwordKeyMaterial(password) {
  return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
}

// Hash de verificación de la contraseña (PBKDF2-SHA256, 256 bits).
export async function hashPassword(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const material = await passwordKeyMaterial(password);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations },
    material,
    256
  );
  return toB64(bits);
}

// Clave AES-GCM derivada de la contraseña con otra sal distinta a la del hash,
// de modo que conocer el hash no permite descifrar los proyectos.
export async function deriveEncryptionKey(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const material = await passwordKeyMaterial(password);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key) {
  return toB64(await crypto.subtle.exportKey("raw", key));
}

export async function importKey(rawB64) {
  return crypto.subtle.importKey("raw", fromB64(rawB64), { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptJSON(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value))
  );
  return { iv: toB64(iv), data: toB64(data) };
}

export async function decryptJSON(key, { iv, data }) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) },
    key,
    fromB64(data)
  );
  return JSON.parse(dec.decode(plain));
}

// Comparación en tiempo constante para no filtrar información por timing.
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
