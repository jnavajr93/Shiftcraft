import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

let gitSha = process.env.VERCEL_GIT_COMMIT_SHA
  ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  : 'unknown'
try {
  gitSha = execSync('git rev-parse --short HEAD').toString().trim()
} catch (_) {}

// jsPDF's ESM bundle imports these optional deps for SVG/HTML-to-canvas features
// we don't use. Stub them so they resolve at build time without adding bundle weight.
// enforce:'pre' runs before Vite's node_modules resolver so installed transitive
// deps (html2canvas, dompurify) are also intercepted and not bundled.
const JSPDF_OPTIONAL = new Set(['canvg', 'html2canvas', 'dompurify']);
const stubOptionalJsPDFDeps = {
  name: 'stub-jspdf-optional-deps',
  enforce: 'pre',
  resolveId(id) {
    if (JSPDF_OPTIONAL.has(id)) return `\0${id}-stub`;
  },
  load(id) {
    if (JSPDF_OPTIONAL.has(id.replace(/^\0/, '').replace(/-stub$/, ''))) {
      return 'export default {};';
    }
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stubOptionalJsPDFDeps],
  define: {
    __GIT_SHA__: JSON.stringify(gitSha),
  },
})
