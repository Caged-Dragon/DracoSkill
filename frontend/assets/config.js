// DracoSkill deployment config.
//
// One line to edit when you deploy. Locally this points at server.py's
// own default port. Once the backend is deployed (Render or otherwise),
// change BACKEND_URL to that real address and every page — the app, the
// certificate module, the connect field — picks it up automatically.
// Python backend on Render: https://your-service.onrender.com
// Vercel backend:          https://your-backend-project.vercel.app
window.DRACOSKILL_CONFIG = {
  BACKEND_URL: "http://localhost:8787"
};
