// Authentication pages: login & registration.

import { API } from '../api.js';
import { esc, I, h, toast } from '../ui.js';
import { navigate, setUser } from '../router.js';
import { CONFIG } from '../config.js';

function authShell(bodyHtml) {
  return h(`<div class="auth-wrap">
    <div class="auth-hero">
      <div class="brand-badge">${I.lab}</div>
      <h1>Interactive Virtual Laboratory &amp; Practical Simulator</h1>
      <p>Read every practical, view the exact original code, and simulate its execution line by line — with explanations, variable states and step-by-step output.</p>
      <div class="hero-feats">
        <div class="hero-feat">${I.check}<span><b>Original code preserved.</b> You study the exact lab manual code — never modified.</span></div>
        <div class="hero-feat">${I.check}<span><b>Line-by-line execution.</b> Step forward and backward through every instruction.</span></div>
        <div class="hero-feat">${I.check}<span><b>See inside the program.</b> Variables, registers, memory and output after every step.</span></div>
        <div class="hero-feat">${I.check}<span><b>Full control.</b> Next, Previous, Run, Pause, Stop and Restart.</span></div>
      </div>
      <div class="auth-links">
        <a href="${CONFIG.THEORY_URL}" target="_blank" rel="noopener noreferrer">${I.link} ${esc(CONFIG.THEORY_LABEL)}</a>
      </div>
    </div>
    <div class="auth-side">${bodyHtml}</div>
  </div>`);
}

export function renderLogin(app) {
  const form = h(`<div class="auth-card card" style="padding:30px">
    <h2>Welcome back</h2>
    <div class="sub">Log in to continue to the laboratory.</div>
    <form id="login-form">
      <div class="field">
        <label>Username or Email</label>
        <input class="input" name="username" autocomplete="username" required>
      </div>
      <div class="field">
        <label>Password</label>
        <input class="input" type="password" name="password" autocomplete="current-password" required>
      </div>
      <button class="btn btn-primary" style="width:100%" type="submit">Log In</button>
    </form>
    <div class="auth-alt">New student? <a href="#/register">Create an account</a></div>
    <div class="auth-alt" style="font-size:12px;color:#94a3b8">
      Demo accounts — student / Student@123 · admin / Admin@123
    </div>
  </div>`);

  app.appendChild(authShell(form.outerHTML));
  const f = document.getElementById('login-form');
  const btn = f.querySelector('button[type=submit]');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    const fd = new FormData(f);
    try {
      const data = await API.post('/auth/login', {
        username: fd.get('username'), password: fd.get('password'),
      });
      API.setCsrf(data.csrf);
      setUser(data.user);
      toast(`Welcome, ${data.user.name}!`, 'success');
      navigate(data.user.role === 'admin' ? 'admin' : 'dashboard');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });
}

export function renderRegister(app) {
  const form = h(`<div class="auth-card card" style="padding:30px">
    <h2>Student Registration</h2>
    <div class="sub">Create your account to enter the Virtual Laboratory.</div>
    <form id="reg-form">
      <div class="field">
        <label>Full Name</label>
        <input class="input" name="name" autocomplete="name" required>
      </div>
      <div class="field">
        <label>Email</label>
        <input class="input" type="email" name="email" autocomplete="email" required>
      </div>
      <div class="two-col">
        <div class="field">
          <label>Username</label>
          <input class="input" name="username" autocomplete="username" pattern="[A-Za-z0-9_]{3,20}" required>
          <div class="hint">3–20 characters (letters, digits, underscore)</div>
        </div>
        <div class="field">
          <label>Enrollment No. <span class="muted">(required)</span></label>
          <input class="input" name="enrollment" required maxlength="30" autocomplete="off">
          <div class="hint">Enter the official college enrollment number. It is verified against the current approved enrollment list.</div>
        </div>
      </div>
      <div class="two-col">
        <div class="field">
          <label>Password</label>
          <input class="input" type="password" name="password" autocomplete="new-password" required>
          <div class="hint">Min 8 chars, include a letter and a digit</div>
        </div>
        <div class="field">
          <label>Confirm Password</label>
          <input class="input" type="password" name="confirm" autocomplete="new-password" required>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%" type="submit">Create Account</button>
    </form>
    <div class="auth-alt">Already registered? <a href="#/login">Log in</a></div>
  </div>`);

  app.appendChild(authShell(form.outerHTML));
  const f = document.getElementById('reg-form');
  const btn = f.querySelector('button[type=submit]');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    if (fd.get('password') !== fd.get('confirm')) {
      toast('Passwords do not match.', 'error');
      return;
    }
    btn.disabled = true; btn.textContent = 'Creating account…';
    try {
      await API.post('/auth/register', {
        name: fd.get('name'), email: fd.get('email'), username: fd.get('username'),
        password: fd.get('password'), enrollment: fd.get('enrollment') || '',
      });
      toast('Registration successful. You can now log in.', 'success');
      navigate('login');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });
}
