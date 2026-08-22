// App bootstrap: restore session, then start the router.

import { API } from './api.js';
import { initRouter, setUser } from './router.js';
import { toast } from './ui.js';

async function boot() {
  try {
    const data = await API.get('/auth/me');
    API.setCsrf(data.csrf);
    setUser(data.user);
  } catch (e) {
    if (e.status === 401) {
      API.setCsrf('');
      setUser(null);
    } else {
      // Server unreachable — show a friendly screen.
      document.getElementById('app').innerHTML = `
        <div class="empty-state" style="min-height:100vh;display:grid;place-items:center">
          <div>
            <h2>Virtual Laboratory</h2>
            <p>Unable to reach the server. Make sure the backend is running (PHP + MongoDB), then refresh.</p>
          </div>
        </div>`;
      return;
    }
  }
  initRouter();
}

boot();
