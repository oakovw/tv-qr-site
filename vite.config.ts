import { defineConfig } from 'vite'

export default defineConfig({
    base: './',
    server: {
        host: true,
        port: 3000
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets'
    }
})