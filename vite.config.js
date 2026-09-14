import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pre-transform keeps the POC source compatible while the repository evolves
// through connector-based commits. This can be removed once the frontend is
// split into production modules during the Frappe integration phase.
const pocSourceCompatibility = {
  name: 'mahanaim-poc-source-compatibility',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/main.jsx')) return null;
    const broken = "</div></Card></div>;if(active==='Reports & analytics')";
    const fixed = "</div></Card></div></>;if(active==='Reports & analytics')";
    return code.includes(broken) ? { code: code.replace(broken, fixed), map: null } : null;
  },
};

export default defineConfig({
  plugins: [pocSourceCompatibility, react()],
});
