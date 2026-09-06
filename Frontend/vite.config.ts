import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    drop: ['console', 'debugger'],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0', // Escucha en todas las interfaces de red
    port: 3000, // Puedes cambiar el puerto si lo necesitas
    // Vite bloquea peticiones cuyo Host no esté en esta lista (protección
    // contra DNS rebinding). Un punto inicial habilita el dominio y todos
    // sus subdominios, así no hay que editar este archivo cada vez que el
    // túnel cambia de URL (ngrok gratuito rota el subdominio en cada arranque).
    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok-free.app',
      '.ngrok.app',
      '.ngrok.io',
      '.trycloudflare.com',
      '.loca.lt',
    ],
    // Reenvía el API al backend local a través del mismo origen, para poder
    // exponer la app con UN solo túnel (ngrok tunelea solo el frontend; el
    // navegador del visitante no alcanza tu localhost:8000).
    //
    // Se usa el prefijo /__api porque varias rutas del API chocan con rutas
    // del SPA — p. ej. /superadmin/system-users existe en ambos —, así que
    // reenviar por prefijo real rompería la navegación. El prefijo se elimina
    // antes de llegar al backend.
    //
    // Se activa poniendo VITE_API_BASE_URL=/__api/ en .env.local.
    proxy: {
      '/__api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (ruta) => ruta.replace(/^\/__api/, ''),
      },
    },
  },
})
