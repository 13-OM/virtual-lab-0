// Student pages: dashboard, practical page (tabs), progress, profile.

import { API } from '../api.js';
import { esc, I, h, toast, pbar, fmtDate, errMsg } from '../ui.js';
import { shell } from '../shell.js';
import { navigate } from '../router.js';
import { CONFIG, getTheoryUrl } from '../config.js';

const studentNav = [
  { href: 'dashboard', label: 'Dashboard', icon: I.dash },
  { href: 'practicals', label: 'Practicals', icon: I.book },
  { href: 'progress', label: 'My Progress', icon: I.clock },
  { href: 'profile', label: 'Profile', icon: I.user },
];

function practicalCardsHtml(practicals) {
  return practicals.map(p => {
    const pr = p.progress || {};
    const pct = pr.completed ? 100 : (p.totalSteps ? Math.round((pr.step || 0) / p.totalSteps * 100) : 0);
    const pctTxt = pr.completed ? '100%' : (pr.step || 0) + '/' + (p.totalSteps || '?') + ' steps';
    return `<div class="card prac-card">
      <div class="pnum">Practical ${String(p.practicalNumber).padStart(2, '0')} ${pr.completed ? `<span class="done-flag">${I.check} completed</span>` : (p.locked ? '<span class="badge badge-yellow">🔒 locked</span>' : '<span class="badge badge-blue">Available</span>')}</div>
      <h3>${esc(p.title)}</h3>
      <div class="pdesc">${esc(p.shortDescription || '')}</div>
      <div class="pmeta">
        <span class="lang-chip">${esc(p.language || '')}</span>
        <span>${pctTxt}</span>
      </div>
      <div class="pbar ${pr.completed ? 'done' : ''}" style="margin-bottom:12px"><div class="pfill" style="width:${pct}%"></div></div>
      <div class="pfoot">
        <span class="small muted">${p.locked ? 'Complete the previous practical first' : (p.totalSteps ? p.totalSteps + ' simulation steps' : 'No steps defined')}</span>
        ${p.locked
          ? `<button class="btn btn-sm btn-outline" disabled title="Complete the previous practical first">🔒 Locked</button>`
          : `<a class="btn btn-sm btn-primary" href="#/practical/${p._id}">${pr.completed ? 'Review Practical' : 'View Practical'}</a>`}
      </div>
    </div>`;
  }).join('') || '<div class="empty-state"><p>No practicals available yet.</p></div>';
}

/** Practicals-only list (sidebar "Practicals" entry). */
export async function renderPracticalsList(app, params, user) {
  const { root, view } = shell(user, studentNav);
  app.appendChild(root);
  view.innerHTML = '<div class="muted">Loading practicals…</div>';
  try {
    const data = await API.get('/practicals');
    view.innerHTML = `
      <div class="page-head"><div><h1>Practicals</h1>
        <div class="crumb">All laboratory practicals from the lab manual — original code preserved</div></div>
        <a class="btn btn-outline" href="${getTheoryUrl()}" target="_blank" rel="noopener noreferrer">${I.link} ${esc(CONFIG.THEORY_LABEL)}</a></div>
      <div class="grid grid-2">${practicalCardsHtml(data.practicals || [])}</div>`;
  } catch (e) {
    view.innerHTML = `<div class="empty-state"><p>${esc(errMsg(e))}</p></div>`;
  }
}

// ---------------------------------------------------------------- dashboard
export async function renderDashboard(app, params, user) {
  const { root, view } = shell(user, studentNav);
  app.appendChild(root);
  view.innerHTML = '<div class="muted">Loading practicals…</div>';
  try {
    const data = await API.get('/practicals');
    const practicals = data.practicals || [];
    const done = practicals.filter(p => p.progress && p.progress.completed).length;

    const cards = practicalCardsHtml(practicals);

    view.innerHTML = `
      <div class="page-head"><div>
        <h1>Welcome, ${esc(user.name.split(' ')[0])} 👋</h1>
        <div class="crumb">Student Laboratory Dashboard</div>
      </div></div>
      <div class="hero-card">
        <div>
          <h2>Your Virtual Laboratory</h2>
          <div class="muted">Read the theory, study the exact original code, then simulate it line by line.</div>
        </div>
        <a class="btn" href="${getTheoryUrl()}" target="_blank" rel="noopener noreferrer">${I.link} ${esc(CONFIG.THEORY_LABEL)}</a>
      </div>
      <div class="grid grid-3" style="margin-bottom:24px">
        <div class="card stat-card"><div class="sc-icon" style="background:#eef2ff;color:#4f46e5">${I.book}</div>
          <div><div class="sc-num">${practicals.length}</div><div class="sc-label">Available practicals</div></div></div>
        <div class="card stat-card"><div class="sc-icon" style="background:#ecfdf3;color:#16a34a">${I.check}</div>
          <div><div class="sc-num">${done}</div><div class="sc-label">Completed</div></div></div>
        <div class="card stat-card"><div class="sc-icon" style="background:#ecfdf9;color:#0d9488">${I.flask}</div>
          <div><div class="sc-num">${practicals.length - done}</div><div class="sc-label">In progress</div></div></div>
      </div>
      <div class="page-head" style="margin-bottom:14px"><h2>Available Practicals</h2></div>
      <div class="grid grid-2">${cards}</div>`;
  } catch (e) {
    view.innerHTML = `<div class="empty-state"><p>${esc(errMsg(e))}</p><button class="btn btn-primary" onclick="location.reload()">Retry</button></div>`;
  }
}

// ---------------------------------------------------------------- practical page
export async function renderPracticalPage(app, params, user) {
  const { root, view } = shell(user, studentNav);
  app.appendChild(root);
  view.innerHTML = '<div class="muted">Loading practical…</div>';

  let practical = null;
  try {
    const data = await API.get('/practicals/' + params.id);
    practical = data.practical;
  } catch (e) {
    if (e.status === 403 && e.data?.code === 'PRACTICAL_LOCKED') {
      view.innerHTML = `<div class="empty-state"><h2>🔒 Practical Locked</h2><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/practicals">Back to Practicals</a></div>`;
    } else {
      view.innerHTML = `<div class="empty-state"><p>${esc(errMsg(e))}</p></div>`;
    }
    return;
  }

  // Preload the highlighter once.
  let hl = null;
  import('/js/highlighter.js').then(m => {
    hl = m.highlightCode;
    if (activeTab === 'code') renderCode();
  });

  let activeTab = 'overview';
  let simMounted = null; // { destroy }
  let engineRef = null;

  const tabsHtml = () => `
    <div class="tabs">
      <button class="tab ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">${I.book} Overview</button>
      <button class="tab ${activeTab === 'code' ? 'active' : ''}" data-tab="code">${I.code} Original Code</button>
      <button class="tab ${activeTab === 'simulator' ? 'active' : ''}" data-tab="simulator">${I.play} Simulator</button>
    </div>`;

  const overviewHtml = () => `
    <div class="content-block">
      <h3>${I.lab} Aim / Objective</h3>
      <div class="body"><p>${esc(practical.aim || '')}</p></div>
    </div>
    ${practical.objective ? `<div class="content-block">
      <h3>${I.check} Learning Objectives</h3>
      <div class="body"><ul>${listItems(practical.objective)}</ul></div>
    </div>` : ''}
    ${practical.theory ? `<div class="content-block">
      <h3>${I.book} Theory</h3>
      <div class="body">${paras(practical.theory)}</div>
    </div>` : ''}
    ${practical.algorithm ? `<div class="content-block">
      <h3>${I.activity} Algorithm / Procedure Steps</h3>
      <div class="body"><ol class="stepped">${listItems(practical.algorithm)}</ol></div>
    </div>` : ''}
    ${practical.procedure ? `<div class="content-block">
      <h3>${I.flask} Procedure (how to run it)</h3>
      <div class="body"><ol class="stepped">${listItems(practical.procedure)}</ol></div>
    </div>` : ''}
    ${practical.expectedOutput ? `<div class="content-block">
      <h3>${I.check} Expected Output</h3>
      <div class="out-box">${esc(practical.expectedOutput)}</div>
    </div>` : ''}`;

  const codeHtml = () => `
    <div class="panel">
      <div class="panel-head"><span>Original Lab Code</span><span class="spacer"></span>
        <span class="lang-chip">${esc(practical.language || '')}</span>
        <span class="badge badge-blue">read-only</span>
        <button class="btn btn-sm btn-ghost" id="btn-copy">Copy</button>
      </div>
      <div class="code-shell" style="border-radius:0;border:none">
        <div class="code-toolbar"><span class="dots"><i style="background:#f87171"></i><i style="background:#fbbf24"></i><i style="background:#34d399"></i></span>
          <span>${esc(fileName(practical))}</span>
          <span class="spacer" style="flex:1"></span><span>${esc(practical.version ? 'v' + practical.version : '')}</span>
        </div>
        <div class="code-scroll"><pre class="code-block" style="padding:12px 14px" id="code-view"></pre></div>
      </div>
    </div>`;

  view.innerHTML = `
    <div class="page-head"><div>
      <div class="crumb"><a href="#/dashboard">Dashboard</a> / Practical ${practical.practicalNumber}</div>
      <h1>Practical ${practical.practicalNumber}: ${esc(practical.title)}</h1>
    </div>
    <a class="btn btn-outline" href="${getTheoryUrl()}" target="_blank" rel="noopener noreferrer">${I.link} ${esc(CONFIG.THEORY_LABEL)}</a></div>
    <div id="tab-area">${tabsHtml()}</div>
    <div id="tab-body"></div>`;

  const tabBody = view.querySelector('#tab-body');
  const tabArea = view.querySelector('#tab-area');

  function renderCode() {
    tabBody.innerHTML = codeHtml();
    const cv = view.querySelector('#code-view');
    const lines = hl ? hl(practical.sourceCode || '', practical.language)
                     : (practical.sourceCode || '').split('\n').map(s => esc(s));
    cv.innerHTML = lines.map((ln, i) => `<div class="code-line todo"><span class="ln">${i + 1}</span><span class="tx">${ln}</span></div>`).join('');
    view.querySelector('#btn-copy').onclick = () => {
      navigator.clipboard.writeText(practical.sourceCode || '')
        .then(() => toast('Code copied to clipboard.', 'success'))
        .catch(() => toast('Could not copy.', 'error'));
    };
  }

  function mountSim() {
    if (simMounted) { tabBody.innerHTML = ''; tabBody.appendChild(simMounted.root); simMounted.view.render(); return; }
    tabBody.innerHTML = '<div class="muted">Loading simulator…</div>';
    Promise.all([import('/js/simulator/engine.js'), import('/js/simulator/view.js')]).then(([{ SimEngine }, { mountSimulator }]) => {
      tabBody.innerHTML = '';
      const root = h('<div id="sim-root"></div>');
      tabBody.appendChild(root);
      const engine = new SimEngine(practical);
      engineRef = engine;

      let nextId = null;
      API.get('/practicals').then(d => {
        const list = d.practicals || [];
        const idx = list.findIndex(p => p._id === practical._id);
        if (idx >= 0 && idx < list.length - 1) nextId = list[idx + 1]._id;
      }).catch(() => {});

      let saveTimer = null;
      const onProgress = (step, done) => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          API.post('/progress', { practicalId: practical._id, step, completed: done }).catch(() => {});
        }, 350);
      };

      const mounted = mountSimulator(root, engine, {
        onProgress,
        nextId: () => nextId,
        onComplete: async () => {
          await API.post('/progress', { practicalId: practical._id, step: engine.total, completed: true });
          practical.progress = { step: engine.total, completed: true };
          toast('Practical marked as completed! 🎉', 'success');
          engine.emit();
        },
        onNextPractical: () => { if (nextId) navigate('practical/' + nextId); },
      });
      simMounted = { root, view: mounted };
      // restore position from saved progress if the student was mid-way
      const saved = practical.progress || {};
      if (saved.step > 0 && !saved.completed && saved.step <= engine.total) {
        engine.cursor = saved.step;
        engine.emit();
      }
    });
  }

  function renderTab() {
    if (activeTab === 'overview') tabBody.innerHTML = overviewHtml();
    else if (activeTab === 'code') renderCode();
    else mountSim();
  }

  tabArea.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    activeTab = t.dataset.tab;
    tabArea.innerHTML = tabsHtml();
    renderTab();
  });

  renderTab();
}

function fileName(p) {
  const lang = (p.language || '').toLowerCase();
  if (lang.includes('lex') || lang.includes('flex')) return 'program.l';
  if (lang.includes('yacc') || lang.includes('bison')) return 'program.y';
  if (lang.includes('python')) return 'program.py';
  if (lang.includes('java')) return 'Program.java';
  if (lang.includes('asm') || lang.includes('8085') || lang.includes('8086') || lang.includes('8051')) return 'program.asm';
  if (lang.includes('c++') || lang.includes('cpp')) return 'program.cpp';
  if (lang.includes('c')) return 'program.c';
  return 'program.txt';
}

function listItems(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => `<li>${esc(s.replace(/^\d+[.)]\s*/, ''))}</li>`).join('');
}
function paras(text) {
  return String(text || '').split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

// ---------------------------------------------------------------- progress
export async function renderProgress(app, params, user) {
  const { root, view } = shell(user, studentNav);
  app.appendChild(root);
  view.innerHTML = '<div class="muted">Loading progress…</div>';
  try {
    const data = await API.get('/progress');
    const rows = data.progress || [];
    const rowsHtml = rows.map(r => {
      const pct = r.completed ? 100 : (r.totalSteps ? Math.round(r.step / r.totalSteps * 100) : 0);
      return `<tr>
        <td><span class="num">${String(r.practicalNumber).padStart(2, '0')}</span></td>
        <td>${esc(r.practicalTitle)}</td>
        <td>${r.completed ? '<span class="done-flag">' + I.check + ' Completed</span>' : '<span class="badge badge-amber">In progress</span>'}</td>
        <td><div style="display:flex;align-items:center;gap:10px">${pbar(pct, r.completed)}<span class="small muted" style="white-space:nowrap">${r.step}/${r.totalSteps || '?'}</span></div></td>
        <td class="small muted">${fmtDate(r.lastAccessed)}</td>
        <td><a class="btn btn-sm btn-outline" href="#/practical/${r.practicalId}">${r.completed ? 'Review' : 'Resume'}</a></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:26px">No progress yet — open a practical and start simulating.</td></tr>';

    view.innerHTML = `
      <div class="page-head"><div><h1>My Progress</h1><div class="crumb">Track your learning across all practicals</div></div></div>
      <div class="panel"><div class="table-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>Practical</th><th>Status</th><th style="width:200px">Progress</th><th>Last accessed</th><th></th></tr></thead>
        <tbody>${rowsHtml}</tbody></table></div></div>`;
  } catch (e) {
    view.innerHTML = `<div class="empty-state"><p>${esc(errMsg(e))}</p></div>`;
  }
}

// ---------------------------------------------------------------- profile
export async function renderProfile(app, params, user) {
  const { root, view } = shell(user, studentNav);
  app.appendChild(root);
  view.innerHTML = `
    <div class="page-head"><div><h1>Profile</h1><div class="crumb">Account details &amp; security</div></div></div>
    <div class="grid grid-2" style="align-items:start">
      <div class="panel" style="padding:22px">
        <h3>Account Information</h3>
        <table class="tbl" style="font-size:14px">
          <tr><td class="muted">Name</td><td><b>${esc(user.name)}</b></td></tr>
          <tr><td class="muted">Username</td><td>${esc(user.username)}</td></tr>
          <tr><td class="muted">Email</td><td>${esc(user.email || '—')}</td></tr>
          <tr><td class="muted">Role</td><td><span class="badge badge-blue">${user.role === 'admin' ? 'Faculty / Admin' : 'Student'}</span></td></tr>
        </table>
      </div>
      <div class="panel" style="padding:22px">
        <h3>Change Password</h3>
        <form id="pw-form">
          <div class="field"><label>Current Password</label><input class="input" type="password" name="current" required></div>
          <div class="field"><label>New Password</label><input class="input" type="password" name="new" required>
            <div class="hint">Min 8 chars, include a letter and a digit</div></div>
          <div class="field"><label>Confirm New Password</label><input class="input" type="password" name="confirm" required></div>
          <button class="btn btn-primary" type="submit">Update Password</button>
        </form>
      </div>
    </div>`;

  const f = view.querySelector('#pw-form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    if (fd.get('new') !== fd.get('confirm')) { toast('New passwords do not match.', 'error'); return; }
    try {
      await API.post('/auth/change-password', { currentPassword: fd.get('current'), newPassword: fd.get('new') });
      toast('Password changed successfully.', 'success');
      f.reset();
    } catch (err) { toast(err.message, 'error'); }
  });
}
