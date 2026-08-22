// Hash-based router with role guards.
// NOTE: guards are UX-only; the backend enforces every permission again.

import { renderLogin, renderRegister } from './pages/auth.js';
import { renderDashboard, renderPracticalsList, renderPracticalPage, renderProgress, renderProfile } from './pages/student.js';
import { renderAdmin } from './pages/admin.js';

const routes = [
  { path: 'login',    render: renderLogin,    public: true },
  { path: 'register', render: renderRegister, public: true },
  // Student pages — also reachable by admins for previewing the lab
  // (admin-only pages remain exclusively for admins).
  { path: 'dashboard', render: renderDashboard, roles: ['student', 'admin'] },
  { path: 'practicals', render: renderPracticalsList, roles: ['student', 'admin'] },
  { path: 'practical/:id', render: renderPracticalPage, roles: ['student', 'admin'] },
  { path: 'progress', render: renderProgress, roles: ['student', 'admin'] },
  { path: 'profile',  render: renderProfile,  roles: ['student', 'admin'] },
  { path: 'admin',    render: (app, params, user) => renderAdmin('dashboard', params, user), roles: ['admin'] },
  { path: 'admin/practicals', render: (app, params, user) => renderAdmin('practicals', params, user), roles: ['admin'] },
  { path: 'admin/practical/new', render: (app, params, user) => renderAdmin('practicalNew', params, user), roles: ['admin'] },
  { path: 'admin/practical/:id/edit', render: (app, params, user) => renderAdmin('practicalEdit', params, user), roles: ['admin'] },
  { path: 'admin/students', render: (app, params, user) => renderAdmin('students', params, user), roles: ['admin'] },
  { path: 'admin/enrollments', render: (app, params, user) => renderAdmin('enrollments', params, user), roles: ['admin'] },
  { path: 'admin/registration-requests', render: (app, params, user) => renderAdmin('registrationRequests', params, user), roles: ['admin'] },
  { path: 'admin/activities', render: (app, params, user) => renderAdmin('activities', params, user), roles: ['admin'] },
];

export function parseHash() {
  const h = (location.hash || '#/dashboard').replace(/^#\/?/, '').replace(/\/$/, '');
  const parts = h.split('/');
  for (const r of routes) {
    const rp = r.path.split('/');
    if (rp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (rp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export function navigate(path) {
  location.hash = '#/' + path;
}

export function currentUser() {
  try { return JSON.parse(localStorage.getItem('vlab_user') || 'null'); } catch { return null; }
}

export function setUser(u) {
  if (u) localStorage.setItem('vlab_user', JSON.stringify(u));
  else localStorage.removeItem('vlab_user');
}

export function route() {
  const app = document.getElementById('app');
  const parsed = parseHash();
  const user = currentUser();

  if (!parsed) {
    app.innerHTML = '<div class="empty-state"><p>Page not found.</p></div>';
    return;
  }
  const { route: r, params } = parsed;

  if (r.public) {
    if (user && (r.path === 'login' || r.path === 'register')) {
      navigate(user.role === 'admin' ? 'admin' : 'dashboard');
      return;
    }
    app.innerHTML = '';
    r.render(app, params);
    return;
  }

  if (!user) {
    navigate('login');
    return;
  }
  if (r.roles && !r.roles.includes(user.role)) {
    navigate(user.role === 'admin' ? 'admin' : 'dashboard');
    return;
  }

  app.innerHTML = '';
  r.render(app, params, user);
}

export function initRouter() {
  window.addEventListener('hashchange', route);
  route();
}
