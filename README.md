# Monitor de uso — manttest

## Requisitos
- Node.js 18+ (incluye npm) — https://nodejs.org

## Poner en marcha en local
```bash
npm install
npm run dev
```
Abre la URL que te indique la terminal (normalmente http://localhost:5173).

## Compilar para desplegar en un hosting
```bash
npm run build
```
Esto genera la carpeta `dist/` con HTML+JS+CSS ya compilados. Sube el contenido
de esa carpeta tal cual a tu hosting estático (Netlify, Vercel, GitHub Pages,
IIS, Apache, S3, etc.).
