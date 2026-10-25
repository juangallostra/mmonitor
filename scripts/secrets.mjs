// Genera el acceso a la app y cifra la lista de proyectos.
//
//   npm run secrets                  -> cifra projects.json (pide la contraseña;
//                                       la primera vez también el usuario)
//   npm run secrets -- --new-password -> cambia usuario/contraseña y vuelve a cifrar
//
// Para entornos sin terminal interactiva: variables MMONITOR_USER y MMONITOR_PASSWORD.
//
// Escribe:
//   src/auth/credentials.js   usuario + hash de la contraseña (se sube a git)
//   src/data/projects.enc.json proyectos cifrados con AES-GCM (se sube a git)
// projects.json, con las contraseñas en claro, NO se sube nunca (.gitignore).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS_PLAIN = path.join(root, "projects.json");
const PROJECTS_ENC = path.join(root, "src", "data", "projects.enc.json");
const CREDENTIALS = path.join(root, "src", "auth", "credentials.js");

const {
  PBKDF2_ITERATIONS,
  hashPassword,
  deriveEncryptionKey,
  encryptJSON,
  randomB64,
  safeEqual,
} = await import(pathToFileURL(path.join(root, "src", "auth", "crypto.js")).href);

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    if (!hidden || !stdin.isTTY) {
      stdin.resume();
      stdin.setEncoding("utf8");
      stdin.once("data", (d) => {
        stdin.pause();
        resolve(String(d).replace(/\r?\n$/, ""));
      });
      return;
    }
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        stdout.write("\n");
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function loadExistingAuth() {
  try {
    const mod = await import(`${pathToFileURL(CREDENTIALS).href}?t=${Date.now()}`);
    return mod.AUTH;
  } catch (e) {
    return null;
  }
}

async function loadProjects() {
  let raw;
  try {
    raw = await readFile(PROJECTS_PLAIN, "utf8");
  } catch (e) {
    fail(
      "No encuentro projects.json en la raíz del proyecto. Copia projects.example.json a projects.json y rellénalo."
    );
  }
  let list;
  try {
    list = JSON.parse(raw);
  } catch (e) {
    fail(`projects.json no es un JSON válido: ${e.message}`);
  }
  if (!Array.isArray(list)) fail("projects.json debe ser un array de proyectos.");

  const seen = new Set();
  list.forEach((p, i) => {
    const where = `projects.json[${i}]`;
    for (const field of ["proyecto", "usuario", "contraseña"]) {
      if (typeof p?.[field] !== "string" || !p[field].trim()) {
        fail(`${where}: falta el campo "${field}".`);
      }
    }
    if (seen.has(p.proyecto)) fail(`${where}: el proyecto "${p.proyecto}" está repetido.`);
    seen.add(p.proyecto);
  });
  return list;
}

const newPassword = process.argv.includes("--new-password");
const projects = await loadProjects();
let auth = await loadExistingAuth();
let password = process.env.MMONITOR_PASSWORD;

if (!auth || newPassword) {
  const username = process.env.MMONITOR_USER || (await ask("Usuario de acceso: "));
  if (!username.trim()) fail("El usuario no puede estar vacío.");
  if (!password) {
    password = await ask("Contraseña de acceso: ", { hidden: true });
    const repeat = await ask("Repite la contraseña: ", { hidden: true });
    if (password !== repeat) fail("Las contraseñas no coinciden.");
  }
  if (password.length < 12) {
    fail("Usa una contraseña de al menos 12 caracteres: el hash es público en el código.");
  }
  const hashSalt = randomB64(16);
  auth = {
    username: username.trim(),
    passwordHash: await hashPassword(password, hashSalt, PBKDF2_ITERATIONS),
    hashSalt,
    keySalt: randomB64(16),
    iterations: PBKDF2_ITERATIONS,
  };
  await writeFile(
    CREDENTIALS,
    `// Generado por \`npm run secrets\`. No editar a mano.\n` +
      `// La contraseña no está aquí: solo su hash PBKDF2-SHA256.\n` +
      `export const AUTH = ${JSON.stringify(auth, null, 2)};\n`
  );
  console.log("✔ Credenciales de acceso actualizadas en src/auth/credentials.js");
} else {
  if (!password) {
    password = await ask(`Contraseña de acceso (usuario "${auth.username}"): `, { hidden: true });
  }
  const hash = await hashPassword(password, auth.hashSalt, auth.iterations);
  if (!safeEqual(hash, auth.passwordHash)) {
    fail("Contraseña incorrecta. Usa --new-password si quieres cambiarla.");
  }
}

const key = await deriveEncryptionKey(password, auth.keySalt, auth.iterations);
const payload = { version: 1, ...(await encryptJSON(key, projects)) };
await writeFile(PROJECTS_ENC, JSON.stringify(payload) + "\n");
console.log(`✔ ${projects.length} proyecto(s) cifrados en src/data/projects.enc.json`);
