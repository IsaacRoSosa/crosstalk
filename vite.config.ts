import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath, URL } from 'url'

import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    // enhancedLogs prefixes every server console.log with a source link, which buries our own logs
    devtools({ enhancedLogs: { enabled: false } }),
    nitro({
      // Only used when building on Vercel. Run the server next to the Supabase database
      // (us-west-2, Oregon) and allow the full 300 s that imports may need.
      vercel: {
        functions: { regions: ['pdx1'], maxDuration: 300 },
      },
    }),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
