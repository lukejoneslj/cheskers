import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // Firebase is large and only needed once the player opens multiplayer, so
    // keep it in its own chunk rather than blocking first paint of the board.
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/database'],
        },
      },
    },
  },
});
