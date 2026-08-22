// ============================================================================
// Admin / Faculty panel — a fully separate protected interface.
// The backend enforces admin-only access on every endpoint; this UI simply
// provides the management screens (dashboard, practicals, simulation data,
// students, activity log).
// ============================================================================

import { API } from '../api.js';
import { esc, I, h, toast, confirmDialog, modal, fmtDate, errMsg, jsonPretty } from '../ui.js';
import { shell } from '../shell.js';
import { navigate, setUser } from '../router.js';
import { CONFIG } from '../config.js';

const adminNav = [
  { href: 'admin', label: 'Dashboard', icon: I.dash },
  { href: 'admin/practicals', label: 'Practicals', icon: I.book },
  { href: 'admin/students', label: 'Students', icon: I.users },
  { href: 'admin/activities', label: 'Activity Log', icon: I.activity },
  { href: 'dashboard', label: '← Student View', icon: I.flask },
];

export async function renderAdmin(section, params, user) {
  const { root, view } = shell(user, adminNav);
  document.getElementById('app').appendChild(root);

  // Forced password change (default admin password) — blocking modal.
  if (user.mustChangePassword) {
    forcePasswordModal(user, () => {
      user.mustChangePassword = false;
      setUser({ ...user });
      go(section, params);
    });
  } else {
    go(section, params);
  }

  async function go(section, params) {
    try {
      if (section === 'dashboard') await pageDashboard(view);
      else if (section === 'practicals') await pagePracticals(view);
      else if (section === 'practicalNew') await pageEditor(view, null);
      else if (section === 'practicalEdit') await pageEditor(view, params.id);
      else if (section === 'students') await pageStudents(view);
      else if (section === 'activities') await pageActivities(view);
    } catch (e) {
      if (e.data && e.data.code === 'PASSWORD_CHANGE_REQUIRED') {
        toast('Please change the default password first.', 'warn');
        forcePasswordModal(user, () => go(section, params));
      } else {
        view.innerHTML = `<div class="empty-state"><p>${esc(errMsg(e))}</p></div>`;
      }
    }
  }
}

// ------------------------------------------------------------ forced password
function forcePasswordModal(user, onDone) {
  const body = h(`<div class="modal-backdrop" style="z-index:300"><div class="modal">
    <div class="modal-head"><h3>Change Default Password Required</h3></div>
    <div class="modal-body">
      <p class="muted" style="font-size:13.5px">For security, you must change the default administrator password before using the admin panel. Your password is stored only as a secure hash.</p>
      <form id="force-pw">
        <div class="field"><label>Current Password</label><input class="input" type="password" name="current" placeholder="the password you logged in with" required></div>
        <div class="field"><label>New Password</label><input class="input" type="password" name="new" required>
          <div class="hint">Min 8 chars, include a letter and a digit</div></div>
        <div class="field"><label>Confirm New Password</label><input class="input" type="password" name="confirm" required></div>
        <button class="btn btn-primary" style="width:100%" type="submit">Change Password &amp; Continue</button>
      </form>
    </div></div></div>`);
  document.body.appendChild(body);
  const f = body.querySelector('#force-pw');
  const btn = f.querySelector('button');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    if (fd.get('new') !== fd.get('confirm')) { toast('New passwords do not match.', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await API.post('/auth/change-password', { currentPassword: fd.get('current'), newPassword: fd.get('new') });
      toast('Password changed. Welcome to the admin panel!', 'success');
      body.remove();
      onDone();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Change Password & Continue';
    }
  });
}

// ------------------------------------------------------------ dashboard
async function pageDashboard(view) {
  view.innerHTML = '<div class="muted">Loading statistics…</div>';
  const data = await API.get('/admin/stats');
  const s = data.stats;

  const usageRows = (data.usage || []).map(u => `<tr>
    <td><span class="num">${String(u.practicalNumber).padStart(2, '0')}</span></td>
    <td>${esc(u.title)}</td>
    <td>${u.views}</td>
    <td>${u.started}</td>
    <td>${u.completed}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No practicals yet.</td></tr>';

  const feed = (data.activity || []).map(a => feedItem(a)).join('') || '<div class="muted small" style="padding:14px 16px">No recent activity.</div>';

  view.innerHTML = `
    <div class="page-head"><div><h1>Faculty / Admin Dashboard</h1>
      <div class="crumb">Manage the entire laboratory content — changes are saved to the laboratory data and every student sees them after refresh/login.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-outline" href="#/admin/practicals">${I.edit} Manage Practicals</a>
        <a class="btn btn-primary" href="#/admin/practical/new">${I.plus} Add Practical</a>
      </div></div>
    <div class="grid grid-4" style="margin-bottom:24px">
      <div class="card stat-card"><div class="sc-icon" style="background:#eef2ff;color:#4f46e5">${I.book}</div>
        <div><div class="sc-num">${s.practicals}</div><div class="sc-label">Practicals</div></div></div>
      <div class="card stat-card"><div class="sc-icon" style="background:#ecfdf3;color:#16a34a">${I.users}</div>
        <div><div class="sc-num">${s.students}</div><div class="sc-label">Registered students</div></div></div>
      <div class="card stat-card"><div class="sc-icon" style="background:#ecfdf9;color:#0d9488">${I.check}</div>
        <div><div class="sc-num">${s.completions}</div><div class="sc-label">Completed simulations</div></div></div>
      <div class="card stat-card"><div class="sc-icon" style="background:#fffbeb;color:#d97706">${I.activity}</div>
        <div><div class="sc-num">${s.users}</div><div class="sc-label">Total accounts</div></div></div>
    </div>
    <div class="admin-grid">
      <div class="panel">
        <div class="panel-head"><span>Practical Usage Statistics</span><span class="spacer"></span>
          <span class="badge badge-blue">views · started · completed</span></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>#</th><th>Practical</th><th>Views</th><th>Started</th><th>Completed</th></tr></thead>
          <tbody>${usageRows}</tbody></table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><span>Recent Activity</span><span class="spacer"></span>
          <a class="btn btn-sm btn-ghost" href="#/admin/activities">View all</a></div>
        <div class="feed">${feed}</div>
      </div>
    </div>`;
}

function feedItem(a) {
  const icons = { login: '→', logout: '←', registered: '✦', completed_practical: '✓', update_practical: '✎', create_practical: '+', delete_practical: '✕', reorder_practicals: '⇅', reset_student_password: '🔑', delete_student: '✕', password_changed: '🔒', restore_practical: '↺' };
  const colors = { login: '#eef2ff;color:#4f46e5', completed_practical: '#ecfdf3;color:#16a34a', update_practical: '#fffbeb;color:#d97706', create_practical: '#ecfdf9;color:#0d9488', registered: '#f5f3ff;color:#7c3aed', delete_practical: '#fef2f2;color:#dc2626', reset_student_password: '#fdf2f8;color:#db2777' };
  const label = a.action.replace(/_/g, ' ');
  const extra = a.details && (a.details.title || a.details.practicalNumber || a.details.username)
    ? ` <b>${esc(a.details.title || a.details.practicalNumber || a.details.username || '')}</b>` : '';
  return `<div class="feed-item">
    <div class="fi-ic" style="background:${colors[a.action] || '#f1f5f9;color:#475569'}">${icons[a.action] || '•'}</div>
    <div style="min-width:0"><div class="fi-tx"><b>${esc(a.name || 'Guest')}</b> ${esc(label)}${extra}</div>
    <div class="fi-time">${fmtDate(a.createdAt)}</div></div></div>`;
}

// ------------------------------------------------------------ practicals list
async function pagePracticals(view) {
  let rows = [];
  view.innerHTML = `
    <div class="page-head"><div><h1>Practical Management</h1>
      <div class="crumb">Add, edit, reorder and remove practicals. All changes are versioned and synchronized to students.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-outline" href="#/admin">← Dashboard</a>
        <a class="btn btn-primary" href="#/admin/practical/new">${I.plus} Add Practical</a>
      </div></div>
    <div class="panel">
      <div class="panel-head">
        <span>Practicals</span><span class="spacer"></span>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="input" id="prac-search" placeholder="Search practicals…" style="width:220px">
        </div>
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Order</th><th>#</th><th>Title</th><th>Language</th><th>Steps</th><th>Version</th><th>Updated</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody id="prac-rows"></tbody></table></div>
    </div>`;

  const tbody = view.querySelector('#prac-rows');
  const search = view.querySelector('#prac-search');

  async function load() {
    tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:22px">Loading…</td></tr>';
    const data = await API.get('/admin/practicals' + (search.value ? '?search=' + encodeURIComponent(search.value) : ''));
    rows = data.practicals || [];
    tbody.innerHTML = rows.map((p, i) => `<tr data-id="${p._id}">
      <td style="white-space:nowrap">
        <button class="icon-btn" data-move="up" title="Move up" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
        <button class="icon-btn" data-move="down" title="Move down" ${i === rows.length - 1 ? 'disabled' : ''}>${I.down}</button>
      </td>
      <td><span class="num">${String(p.practicalNumber).padStart(2, '0')}</span></td>
      <td>${esc(p.title)}</td>
      <td><span class="lang-chip">${esc(p.language)}</span></td>
      <td>${p.stepCount}</td>
      <td>v${p.version}</td>
      <td class="small muted">${fmtDate(p.updatedAt)}</td>
      <td><div class="actions">
        <button class="btn btn-sm btn-outline" data-act="edit">${I.edit} Edit</button>
        <button class="btn btn-sm btn-ghost" data-act="history">${I.history} Versions</button>
        <button class="btn btn-sm btn-ghost" data-act="delete" style="color:var(--danger)">${I.trash}</button>
      </div></td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:22px">No practicals found.</td></tr>';
  }

  let debounceT;
  search.addEventListener('input', () => { clearTimeout(debounceT); debounceT = setTimeout(load, 300); });

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act], button[data-move]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    const idx = rows.findIndex(r => r._id === id);

    if (btn.dataset.move) {
      const dir = btn.dataset.move === 'up' ? -1 : 1;
      const j = idx + dir;
      if (j < 0 || j >= rows.length) return;
      [rows[idx], rows[j]] = [rows[j], rows[idx]];
      await API.post('/admin/practicals', { ids: rows.map(r => r._id) });
      await load();
      toast('Practical order updated.', 'success');
    } else if (btn.dataset.act === 'edit') {
      navigate('admin/practical/' + id + '/edit');
    } else if (btn.dataset.act === 'history') {
      showHistory(id);
    } else if (btn.dataset.act === 'delete') {
      const ok = await confirmDialog('Delete Practical', 'This will permanently remove the practical and all student progress for it. Continue?', 'Delete');
      if (!ok) return;
      try {
        await API.del('/admin/practicals/' + id);
        toast('Practical deleted.', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  await load();
}

async function showHistory(id) {
  try {
    const data = await API.get('/admin/practicals/' + id + '/history');
    const items = (data.history || []).map(v => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <span class="badge badge-blue">v${v.version}</span>
        <span class="small muted" style="flex:1">by ${esc(v.updatedBy || '—')} · ${fmtDate(v.updatedAt)}</span>
        <button class="btn btn-sm btn-outline" data-restore="${v.version}">Restore</button>
      </div>`).join('') || '<p class="muted">No previous versions yet.</p>';
    const m = modal('Version History', `<div style="max-height:50vh;overflow:auto">${items}</div>`);
    m.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
      try {
        await API.post('/admin/practicals/' + id + '/restore', { version: parseInt(b.dataset.restore, 10) });
        toast('Practical restored. Students will see the restored version.', 'success');
        m.remove();
        navigate('admin/practicals');
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) { toast(err.message, 'error'); }
}

// ------------------------------------------------------------ practical editor
async function pageEditor(view, id) {
  const isNew = !id;
  const form = {
    practicalNumber: '', title: '', shortDescription: '', language: 'LEX (flex)',
    aim: '', objective: '', theory: '', algorithm: '', procedure: '',
    sourceCode: '', expectedOutput: '',
    simulationData: { cells: [], initial: {}, steps: [], finalOutput: '' },
  };

  if (!isNew) {
    view.innerHTML = '<div class="muted">Loading practical…</div>';
    try {
      const data = await API.get('/admin/practicals/' + id);
      const p = data.practical;
      Object.assign(form, {
        practicalNumber: p.practicalNumber, title: p.title, shortDescription: p.shortDescription || '',
        language: p.language || 'LEX (flex)', aim: p.aim || '', objective: p.objective || '',
        theory: p.theory || '', algorithm: p.algorithm || '', procedure: p.procedure || '',
        sourceCode: p.sourceCode || '', expectedOutput: p.expectedOutput || '',
      });
      form.simulationData = p.simulationData || form.simulationData;
    } catch (e) {
      view.innerHTML = `<div class="empty-state"><p>${esc(errMsg(e))}</p></div>`;
      return;
    }
  }

  let tab = 'details';

  const tabsHtml = () => `<div class="editor-tabs">
    <button class="tab ${tab === 'details' ? 'active' : ''}" data-tab="details">${I.edit} Details &amp; Theory</button>
    <button class="tab ${tab === 'simulation' ? 'active' : ''}" data-tab="simulation">${I.play} Simulation Data</button>
  </div>`;

  view.innerHTML = `
    <div class="page-head"><div>
      <div class="crumb"><a href="#/admin/practicals">Practicals</a> / ${isNew ? 'New Practical' : 'Edit Practical'}</div>
      <h1>${isNew ? 'Add New Practical' : 'Edit Practical ' + (form.practicalNumber || '')}</h1>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
      <button class="btn btn-primary" id="btn-save">${I.check} Save Changes</button>
    </div></div>
    <div id="editor-tabs">${tabsHtml()}</div>
    <div id="editor-body"></div>`;

  const tabsEl = view.querySelector('#editor-tabs');
  const bodyEl = view.querySelector('#editor-body');

  view.querySelector('#btn-cancel').onclick = () => navigate('admin/practicals');
  view.querySelector('#btn-save').onclick = save;

  function detailsHtml() {
    const opts = CONFIG.LANGUAGES.map(l => `<option ${form.language === l ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<div class="panel form-card">
      <div class="two-col">
        <div class="field"><label>Practical Number</label>
          <input class="input" id="f-number" type="number" min="1" value="${esc(form.practicalNumber)}"></div>
        <div class="field"><label>Language</label>
          <select class="input" id="f-language">${opts}<option ${!CONFIG.LANGUAGES.includes(form.language) ? 'selected' : ''}>${esc(form.language)}</option></select></div>
      </div>
      <div class="field"><label>Title</label>
        <input class="input" id="f-title" value="${esc(form.title)}" placeholder="e.g. LEX program to count lines, words and characters"></div>
      <div class="field"><label>Short Description (shown on the dashboard card)</label>
        <input class="input" id="f-short" value="${esc(form.shortDescription)}"></div>
      <div class="field"><label>Aim / Objective</label>
        <textarea class="textarea" id="f-aim" rows="3">${esc(form.aim)}</textarea></div>
      <div class="field"><label>Learning Objectives (one per line)</label>
        <textarea class="textarea" id="f-objective" rows="4">${esc(form.objective)}</textarea></div>
      <div class="field"><label>Theory</label>
        <textarea class="textarea" id="f-theory" rows="10">${esc(form.theory)}</textarea></div>
      <div class="field"><label>Algorithm (one step per line)</label>
        <textarea class="textarea" id="f-algorithm" rows="7">${esc(form.algorithm)}</textarea></div>
      <div class="field"><label>Procedure (one step per line)</label>
        <textarea class="textarea" id="f-procedure" rows="7">${esc(form.procedure)}</textarea></div>
      <div class="field"><label>Original Source Code (preserved exactly)</label>
        <textarea class="textarea mono code-input" id="f-code" rows="14" spellcheck="false">${esc(form.sourceCode)}</textarea>
        <div class="hint">Students see this code read-only and simulate it line by line. Keep it exactly as in the lab manual.</div></div>
      <div class="field"><label>Expected Output</label>
        <textarea class="textarea mono" id="f-output" rows="4" spellcheck="false">${esc(form.expectedOutput)}</textarea></div>
    </div>`;
  }

  function simulationHtml() {
    const steps = form.simulationData.steps || [];
    const cells = form.simulationData.cells || [];
    const stepRows = steps.map((s, i) => {
      const srcLine = (form.sourceCode || '').split('\n')[Math.max(0, (s.line || 1) - 1)] || '';
      return `<div class="step-row" data-i="${i}">
        <div class="sr-head">
          <span class="sr-idx">#${i + 1}</span>
          <span class="sr-line">line ${esc(s.line || 1)}</span>
          <span class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">${esc(s.what || srcLine || '')}</span>
          <span class="spacer"></span>
          <button class="icon-btn" data-step="up" title="Move up">${I.up}</button>
          <button class="icon-btn" data-step="down" title="Move down">${I.down}</button>
          <button class="icon-btn" data-step="dup" title="Duplicate">⧉</button>
          <button class="icon-btn" data-step="del" title="Delete" style="color:var(--danger)">${I.trash}</button>
        </div>
        <div class="sr-body">
          <div class="two-col">
            <div class="field"><label>Source line number</label><input class="input" data-f="line" type="number" min="1" value="${esc(s.line || 1)}"></div>
            <div class="field"><label>Output for this step</label><input class="input" data-f="output" value="${esc(s.output || '')}" placeholder="e.g. Matched \"hello\" -> words = 1"></div>
          </div>
          <div class="field"><label>What — what does this line do?</label><textarea class="textarea" data-f="what" rows="2">${esc(s.what || '')}</textarea></div>
          <div class="field"><label>Why — why is this line needed?</label><textarea class="textarea" data-f="why" rows="2">${esc(s.why || '')}</textarea></div>
          <div class="field"><label>How — how does it affect execution?</label><textarea class="textarea" data-f="how" rows="2">${esc(s.how || '')}</textarea></div>
          <div class="field"><label>Result — what changed?</label><textarea class="textarea" data-f="result" rows="2">${esc(s.result || '')}</textarea></div>
          <div class="two-col">
            <div class="field"><label>State BEFORE (JSON object)</label><textarea class="textarea mono" data-f="before" rows="4" spellcheck="false">${esc(jsonPretty(s.before || {}))}</textarea></div>
            <div class="field"><label>State AFTER (JSON object)</label><textarea class="textarea mono" data-f="after" rows="4" spellcheck="false">${esc(jsonPretty(s.after || {}))}</textarea></div>
          </div>
        </div>
      </div>`;
    }).join('');

    return `<div class="panel form-card">
      <h3>Simulation Definition</h3>
      <p class="muted small" style="margin-top:-6px">Each step = one executable line of the original code, with an explanation and a before/after state snapshot. The simulator engine replays these steps forward and backward.</p>
      <div class="two-col">
        <div class="field"><label>State variables (key per line: key|Label|kind)</label>
          <textarea class="textarea mono" id="f-cells" rows="5" spellcheck="false">${esc((cells.map(c => `${c.key}|${c.label || c.key}|${c.kind || 'text'}`).join('\n')))}</textarea>
          <div class="hint">kinds: text · num · small</div></div>
        <div class="field"><label>Initial state (JSON object)</label>
          <textarea class="textarea mono" id="f-initial" rows="5" spellcheck="false">${esc(jsonPretty(form.simulationData.initial || {}))}</textarea></div>
      </div>
      <div class="field"><label>Final output (shown when simulation completes)</label>
        <textarea class="textarea mono" id="f-final" rows="3" spellcheck="false">${esc(form.simulationData.finalOutput || '')}</textarea></div>
      <div style="display:flex;gap:10px;margin:14px 0 18px">
        <button class="btn btn-outline" id="btn-add-step">${I.plus} Add Step</button>
        <button class="btn btn-ghost" id="btn-autogen">⚡ Auto-generate steps from code</button>
        <button class="btn btn-ghost" id="btn-clear-steps">Clear all steps</button>
      </div>
      <div id="step-list">${stepRows || '<div class="empty-state"><p>No simulation steps yet.</p></div>'}</div>
    </div>`;
  }

  function collectDetails() {
    form.practicalNumber = view.querySelector('#f-number').value;
    form.title = view.querySelector('#f-title').value;
    form.shortDescription = view.querySelector('#f-short').value;
    form.language = view.querySelector('#f-language').value;
    form.aim = view.querySelector('#f-aim').value;
    form.objective = view.querySelector('#f-objective').value;
    form.theory = view.querySelector('#f-theory').value;
    form.algorithm = view.querySelector('#f-algorithm').value;
    form.procedure = view.querySelector('#f-procedure').value;
    form.sourceCode = view.querySelector('#f-code').value;
    form.expectedOutput = view.querySelector('#f-output').value;
  }

  function collectSimulation() {
    // cells
    form.simulationData.cells = (view.querySelector('#f-cells').value || '').split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => { const [key, label, kind] = l.split('|'); return { key: key.trim(), label: (label || key).trim(), kind: (kind || 'text').trim() }; });
    // initial
    try { form.simulationData.initial = JSON.parse(view.querySelector('#f-initial').value || '{}'); }
    catch { toast('Initial state is not valid JSON.', 'error'); return false; }
    form.simulationData.finalOutput = view.querySelector('#f-final').value;
    // steps
    const steps = [];
    const rows = view.querySelectorAll('#step-list .step-row');
    rows.forEach((row, i) => {
      const get = (f) => row.querySelector(`[data-f="${f}"]`).value;
      let before = {}, after = {};
      try { before = JSON.parse(get('before') || '{}'); } catch { toast(`Step ${i + 1}: "State before" is not valid JSON.`, 'error'); throw new Error('invalid'); }
      try { after = JSON.parse(get('after') || '{}'); } catch { toast(`Step ${i + 1}: "State after" is not valid JSON.`, 'error'); throw new Error('invalid'); }
      steps.push({
        line: parseInt(get('line'), 10) || 1,
        what: get('what'), why: get('why'), how: get('how'), result: get('result'),
        before, after, output: get('output'),
      });
    });
    form.simulationData.steps = steps;
    return true;
  }

  function autogen() {
    const lines = (form.sourceCode || '').split('\n');
    form.simulationData.steps = lines.map((ln, i) => ({
      line: i + 1, what: 'Executes: ' + (ln.trim() || '(empty line)'),
      why: 'This line is part of the program flow.',
      how: 'The instruction is processed; its effect is reflected in the program state.',
      result: 'Execution moves to the next instruction.',
      before: {}, after: {}, output: '',
    })).filter((s, i) => (form.sourceCode || '').split('\n')[s.line - 1].trim() !== '');
  }

  function render() {
    tabsEl.innerHTML = tabsHtml();
    bodyEl.innerHTML = tab === 'details' ? detailsHtml() : simulationHtml();

    bodyEl.querySelectorAll('.step-row .sr-head').forEach(head => {
      head.addEventListener('click', (e) => {
        if (e.target.closest('[data-step]')) return;
        head.parentElement.classList.toggle('open');
      });
    });

    const listEl = bodyEl.querySelector('#step-list');
    if (listEl) listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step]');
      if (!btn) return;
      const row = btn.closest('.step-row');
      const i = parseInt(row.dataset.i, 10);
      const steps = form.simulationData.steps;
      if (btn.dataset.step === 'del') { steps.splice(i, 1); }
      else if (btn.dataset.step === 'up' && i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; }
      else if (btn.dataset.step === 'down' && i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; }
      else if (btn.dataset.step === 'dup') { steps.splice(i + 1, 0, { ...steps[i] }); }
      render();
    });

    const addBtn = bodyEl.querySelector('#btn-add-step');
    if (addBtn) addBtn.onclick = () => {
      form.simulationData.steps.push({ line: 1, what: '', why: '', how: '', result: '', before: {}, after: {}, output: '' });
      render();
      const last = bodyEl.querySelectorAll('.step-row');
      if (last.length) last[last.length - 1].classList.add('open');
    };
    const autoBtn = bodyEl.querySelector('#btn-autogen');
    if (autoBtn) autoBtn.onclick = async () => {
      const ok = await confirmDialog('Auto-generate steps', 'Replace current steps with one generic step per source line? You can refine each explanation afterwards.', 'Generate', false);
      if (!ok) return;
      autogen();
      render();
      toast('Generated ' + form.simulationData.steps.length + ' generic steps. Refine the explanations as needed.', 'success');
    };
    const clearBtn = bodyEl.querySelector('#btn-clear-steps');
    if (clearBtn) clearBtn.onclick = async () => {
      const ok = await confirmDialog('Clear steps', 'Remove all simulation steps for this practical?', 'Clear', true);
      if (!ok) return;
      form.simulationData.steps = [];
      render();
    };
  }

  async function save() {
    try {
      if (tab === 'details') collectDetails();
      else if (!collectSimulation()) return;

      if (!form.title.trim()) { toast('Title is required.', 'error'); return; }
      if (!form.practicalNumber || form.practicalNumber < 1) { toast('Practical number is required.', 'error'); return; }
      if (!form.sourceCode.trim()) { toast('Source code is required.', 'error'); return; }

      const payload = {
        practicalNumber: parseInt(form.practicalNumber, 10), title: form.title.trim(),
        shortDescription: form.shortDescription, language: form.language,
        aim: form.aim, objective: form.objective, theory: form.theory,
        algorithm: form.algorithm, procedure: form.procedure,
        sourceCode: form.sourceCode, expectedOutput: form.expectedOutput,
        simulationData: form.simulationData,
      };

      const btn = view.querySelector('#btn-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      if (isNew) await API.post('/admin/practicals', payload);
      else await API.put('/admin/practicals/' + id, payload);
      toast(isNew ? 'Practical created. Students can now access it.' : 'Practical updated. All students will see the new version immediately.', 'success');
      navigate('admin/practicals');
    } catch (err) {
      toast(err.message, 'error');
      const btn = view.querySelector('#btn-save');
      if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
  }

  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    try {
      if (tab === 'details') collectDetails();
      else collectSimulation();
    } catch { return; }
    tab = t.dataset.tab;
    render();
  });

  render();
}

// ------------------------------------------------------------ students
async function pageStudents(view) {
  view.innerHTML = '<div class="muted">Loading students…</div>';
  const data = await API.get('/admin/students');
  const rows = (data.students || []).map(s => `<tr data-id="${s._id}">
    <td><b>${esc(s.name)}</b></td>
    <td>${esc(s.username)}</td>
    <td class="small">${esc(s.email)}</td>
    <td class="small">${esc(s.enrollment || '—')}</td>
    <td>${s.completed}</td>
    <td class="small muted">${fmtDate(s.createdAt)}</td>
    <td class="small muted">${fmtDate(s.lastLoginAt)}</td>
    <td><div class="actions">
      <button class="btn btn-sm btn-outline" data-act="reset">Reset Password</button>
      <button class="btn btn-sm btn-ghost" data-act="del" style="color:var(--danger)">${I.trash}</button>
    </div></td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:22px">No students registered yet.</td></tr>';

  view.innerHTML = `
    <div class="page-head"><div><h1>Student Management</h1>
      <div class="crumb">View registered students, reset passwords and remove accounts</div></div></div>
    <div class="panel"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Enrollment</th><th>Completed</th><th>Registered</th><th>Last login</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;

  const tbody = view.querySelector('tbody');
  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const name = tr.children[0].textContent;

    if (btn.dataset.act === 'reset') {
      const m = modal('Reset Password', `
        <p class="muted small">Set a new password for <b>${esc(name)}</b>. The student will use it at the next login.</p>
        <div class="field" style="margin-top:12px"><label>New Password</label>
          <input class="input" type="text" id="new-pw" value="Student@123" autocomplete="off"></div>`);
      const input = m.querySelector('#new-pw');
      m.querySelectorAll('[data-close]')[0].onclick = () => m.remove();
      const apply = h(`<button class="btn btn-primary" id="pw-ok">Save New Password</button>`);
      m.querySelector('.modal-foot').appendChild(apply);
      apply.onclick = async () => {
        try {
          await API.post('/admin/students/' + tr.dataset.id + '/reset-password', { newPassword: input.value });
          toast('Password updated.', 'success');
          m.remove();
        } catch (err) { toast(err.message, 'error'); }
      };
    } else if (btn.dataset.act === 'del') {
      const ok = await confirmDialog('Remove Student', `Remove <b>${esc(name)}</b> and all of their progress? This cannot be undone.`, 'Remove');
      if (!ok) return;
      try {
        await API.del('/admin/students/' + tr.dataset.id);
        toast('Student removed.', 'success');
        tr.remove();
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

// ------------------------------------------------------------ activities
async function pageActivities(view) {
  view.innerHTML = '<div class="muted">Loading activity log…</div>';
  const data = await API.get('/admin/activities?limit=100');
  const feed = (data.activities || []).map(a => feedItem(a)).join('') || '<div class="muted" style="padding:20px">No activity recorded yet.</div>';
  view.innerHTML = `
    <div class="page-head"><div><h1>Activity Log</h1>
      <div class="crumb">Who did what — logins, completions and content changes</div></div></div>
    <div class="panel"><div class="feed">${feed}</div></div>`;
}
