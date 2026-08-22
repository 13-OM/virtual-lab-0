// Shared authenticated layout: sidebar + topbar + main view.

import { esc, I, h, toast } from './ui.js';
import { CONFIG, getTheoryUrl } from './config.js';
import { navigate, setUser } from './router.js';
import { API } from './api.js';

export function logout() {
  API.post('/auth/logout').catch(() => {});
  API.setCsrf('');
  setUser(null);
  toast('Logged out.', 'info');
  navigate('login');
}

/**
 * Build the app shell. Returns { view, sidebar } DOM nodes.
 * @param {object} user
 * @param {Array<{href:string,label:string,icon:string}>} navItems
 */
export function shell(user, navItems) {
  const active = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const initials = (user.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2);

  const navHtml = navItems.map(n => {
    const cls = active === n.href || active.startsWith(n.href + '/') ? 'active' : '';
    return `<a class="nav-item ${cls}" href="#/${n.href}">${n.icon}<span>${esc(n.label)}</span></a>`;
  }).join('');

  const root = h(`<div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-badge">${I.lab}</div>
        <div>
          <div class="brand-name">Virtual<br>Laboratory</div>
          <div class="brand-sub">Interactive Practical Simulator</div>
        </div>
      </div>
      <nav class="side-nav">
        <div class="nav-label">Main</div>
        ${navHtml}
      </nav>
      <div class="sidebar-foot">
        <a class="theory-link" href="${getTheoryUrl()}" target="_blank" rel="noopener noreferrer">
          ${I.link}<span>${esc(CONFIG.THEORY_LABEL)}</span>
        </a>
        <div class="user-menu-wrap">
        <button class="user-chip" id="btn-user-menu" type="button" aria-expanded="false" aria-controls="user-menu">
          <div class="avatar">${esc(initials)}</div>
          <div class="user-meta">
            <div class="u-name">${esc(user.name || '')}</div>
            <div class="u-role">${user.role === 'admin' ? 'Faculty / Admin' : 'Student'}</div>
          </div>
          <span class="user-chevron">⌄</span>
        </button>
        <div class="user-menu" id="user-menu" hidden>
          <div class="user-menu-head">
            <strong>${esc(user.name || '')}</strong>
            <span>${user.role === 'admin' ? 'Administrator' : 'Student account'}</span>
          </div>
          <button class="user-menu-item logout-item" id="btn-logout" type="button">
            ${I.logout}<span>Logout</span>
          </button>
        </div>
      </div>
      </div>
    </aside>
    <div class="topbar">
      <button class="icon-btn" id="btn-menu" style="color:#cbd5e1">${I.menu}</button>
      <span class="tb-title">Virtual Laboratory</span>
    </div>
    <main class="main">
      <div class="app-backbar">
        <button class="btn btn-ghost btn-sm app-back" id="btn-back" type="button" title="Go back to the previous page">← Back</button>
      </div>
      <div class="main-inner" id="view"></div>
    </main>
  </div>`);

  const userMenuButton = root.querySelector('#btn-user-menu');
  const userMenu = root.querySelector('#user-menu');
  userMenuButton.onclick = () => {
    const open = userMenu.hidden;
    userMenu.hidden = !open;
    userMenuButton.setAttribute('aria-expanded', String(open));
  };
  root.querySelector('#btn-logout').onclick = logout;
  root.querySelector('#btn-menu').onclick = () => root.querySelector('#sidebar').classList.toggle('open');
  root.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu-wrap')) {
      userMenu.hidden = true;
      userMenuButton.setAttribute('aria-expanded', 'false');
    }
  });
  root.querySelector('#btn-back').onclick = () => {
    // Hash navigation creates normal browser history entries. Use the same
    // history so Back never logs the user out or resets their session.
    if (history.length > 1) history.back();
    else navigate(user.role === 'admin' ? 'admin' : 'dashboard');
  };
  root.querySelectorAll('.nav-item').forEach(a => a.addEventListener('click', () => root.querySelector('#sidebar').classList.remove('open')));

  return { root, view: root.querySelector('#view'), sidebar: root.querySelector('#sidebar') };
}
