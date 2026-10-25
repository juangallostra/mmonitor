# Monitor de uso — manttest

## Requisitos
- Node.js 18+ (incluye npm) — https://nodejs.org

## Poner en marcha en local
```bash
npm install
npm run dev
```
Abre la URL que te indique la terminal (normalmente http://localhost:5173).

## Acceso y proyectos
La app pide un usuario y una contraseña únicos antes de mostrar nada. En el
código solo está el hash de la contraseña (PBKDF2-SHA256); la misma contraseña
descifra la lista de proyectos, que se publica cifrada (AES-GCM).

1. Copia `projects.example.json` a `projects.json` y rellénalo. Campos
   obligatorios: `proyecto`, `usuario`, `contraseña`. Opcionales: `nombre`
   (por defecto, el código de proyecto) y `url` (por defecto,
   `https://saas.manttest.net/<proyecto>`).
2. Ejecuta `npm run secrets`. La primera vez te pide el usuario y la
   contraseña de acceso (mínimo 12 caracteres); las siguientes, solo la
   contraseña, y vuelve a cifrar los proyectos.
3. Sube a git `src/auth/credentials.js` y `src/data/projects.enc.json`.
   `projects.json` está en `.gitignore` y **no debe subirse nunca**.

Para cambiar el usuario o la contraseña: `npm run secrets -- --new-password`.
Los proyectos añadidos desde la interfaz se guardan cifrados en el navegador;
al cambiar la contraseña se pierden, así que pásalos antes a `projects.json`.

## Compilar para desplegar en un hosting
```bash
npm run build
```
Esto genera la carpeta `dist/` con HTML+JS+CSS ya compilados. Sube el contenido
de esa carpeta tal cual a tu hosting estático (Netlify, Vercel, GitHub Pages,
IIS, Apache, S3, etc.).
