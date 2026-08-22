// API client — same-origin requests to the shared MongoDB-backed Express API.
// Credentials never live in the frontend; sessions are server-side cookies.

let csrfToken = sessionStorage.getItem('vlab_csrf') || '';

export const API = {
  get csrf() { return csrfToken; },
  setCsrf(t) {
    csrfToken = t || '';
    if (t) sessionStorage.setItem('vlab_csrf', t);
    else sessionStorage.removeItem('vlab_csrf');
  },

  async req(method, path, body) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    if (csrfToken && method !== 'GET') opt.headers['X-CSRF-Token'] = csrfToken;

    let res;
    try {
      res = await fetch('/api' + path, opt);
    } catch {
      throw Object.assign(new Error('Unable to reach the server. Please check your connection.'), { status: 0 });
    }

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }

    if (res.status === 401 && !path.startsWith('/auth/')) {
      API.setCsrf('');
      localStorage.removeItem('vlab_user');
      if (!location.hash.startsWith('#/login')) location.hash = '#/login';
      throw Object.assign(new Error((data && data.error) || 'Session expired. Please log in again.'), { status: 401 });
    }
    if (!res.ok) {
      throw Object.assign(new Error((data && data.error) || 'Request failed.'), { status: res.status, data });
    }
    return data;
  },

  get(p)  { return this.req('GET', p); },
  post(p, b) { return this.req('POST', p, b === undefined ? {} : b); },
  put(p, b)  { return this.req('PUT', p, b === undefined ? {} : b); },
  del(p)  { return this.req('DELETE', p); },
};
