import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves the dashboard over HTTPS with a self-signed
// certificate. Browsers open the field worker's camera only on HTTPS or
// localhost, so this is how a phone on the same Wi-Fi can photograph a repair.
// The phone shows a certificate warning once; accept it to continue.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
}));
