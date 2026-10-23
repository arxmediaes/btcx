import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'./',plugins:[react()],define:{'process.env.NODE_ENV':JSON.stringify('production'),'import.meta.env.VITE_APP_NAME':JSON.stringify('hyrule')},build:{outDir:'docs',emptyOutDir:true,sourcemap:false}});
