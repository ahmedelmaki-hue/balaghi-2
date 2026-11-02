import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves the dashboard over HTTPS with a self-signed
// certificate. Browsers open the field worker's camera only on HTTPS or
// localhost, so this is how a phone on the same Wi-Fi can photograph a repair.
// The phone shows a certificate warning once; accept it to continue.
// Libraries change rarely, so each gets its own file that browsers keep cached
// across dashboard releases, and no single file passes 500 kB.
const vendorChunks = {
  react: ['/node_modules/react/', '/node_modules/react-dom/', '/node_modules/scheduler/'],
  leaflet: ['/node_modules/leaflet/'],
  icons: ['/node_modules/lucide-react/'],
};

export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const file = id.replace(/\\/g, '/');
          return Object.keys(vendorChunks).find((name) =>
            vendorChunks[name].some((dir) => file.includes(dir)));
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
}));
