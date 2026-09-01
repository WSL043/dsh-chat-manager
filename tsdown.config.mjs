import { defineConfig } from 'tsdown'

const id = 'dsh-chat-manager'

export default defineConfig([
  { name: id, entry: { index: 'src/index.js' }, outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: true },
  {
    name: `${id}/client`, entry: { client: 'src/client.jsx' }, outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022', dts: false, sourcemap: true, clean: false,
    deps: { neverBundle: ['react', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots'] },
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    outputOptions: { entryFileNames: 'client.js', banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`, footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' },
  },
])
