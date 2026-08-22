// ============================================================================
// Virtual Laboratory — Line-by-Line Simulator (v3) view
//
// Layout principle: the learner should always see the source line, explanation,
// state, and controls together. No page reloads and no timer-driven DOM rebuild.
// ============================================================================
'use strict';

import { esc, I, h } from '../ui.js';
import { highlightCode } from '../highlighter.js';
import { CONFIG, getTheoryUrl } from '../config.js';

export function mountSimulator(container, engine, opts = {}) {
  const practical = engine.practical;
  const codeHtml = highlightCode(practical.sourceCode || '', engine.lang);
  const cellDefs = engine.cells || Object.keys(engine.initial || {}).map(key => ({ key, label: key, kind: 'text' }));

  container.innerHTML = `
    <div class="sim-v3">
      <div class="sim-head">
        <div>
          <h2>Practical ${esc(practical.practicalNumber)} — ${esc(practical.title)}</h2>
          <div class="sim-meta">
            <span class="lang-chip">${esc(engine.lang || '')}</span>
            <span>Complete source walkthrough • one line per step</span>
          </div>
        </div>
        <a class="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href="${getTheoryUrl()}">
          ${I.link} ${esc(CONFIG.THEORY_LABEL)}
        </a>
      </div>

      <div class="sim-guide sim-guide-v3">
        <div class="sim-guide-icon">${I.activity}</div>
        <div>
          <strong>Student-controlled flow</strong>
          <span><b>Next</b> moves exactly one source line. <b>Previous</b> goes back. <b>Play/Pause</b> controls automatic progress. <b>Finish</b> goes to the end. Nothing is skipped automatically.</span>
        </div>
      </div>

      <div class="sim-progress sim-progress-v3">
        <div class="pbar" id="sim-pbar"><div class="pfill"></div></div>
        <div class="sim-counter" id="sim-counter">Line 0 / ${engine.total}</div>
      </div>

      <div class="sim-controls sim-controls-v3" role="toolbar" aria-label="Line by line simulator controls">
        <button class="btn btn-ghost" id="btn-prev" title="Move back one line">${I.prev} Back</button>
        <button class="btn btn-primary" id="btn-next" title="Execute the next walkthrough line">Next ${I.next}</button>
        <button class="btn" id="btn-play" title="Start automatic line-by-line walkthrough">${I.play} Play</button>
        <button class="btn" id="btn-pause" title="Pause automatic walkthrough" disabled>${I.pause} Pause</button>
        <button class="btn btn-ghost" id="btn-restart" title="Return to the beginning">${I.restart} Restart</button>
        <button class="btn btn-ghost" id="btn-finish" title="Go to the final line">${I.check} Finish</button>
        <div class="sim-status" id="sim-status">Ready</div>
      </div>

      <div class="sim-flowbar">
        <div><span class="flow-k">CURRENT</span><b id="flow-current">Start</b></div>
        <div class="flow-arrow">→</div>
        <div><span class="flow-k">NEXT</span><b id="flow-next">Line 1</b></div>
        <div class="flow-hint">Keyboard: ← Back · → Next · Space Play/Pause · Home Restart · End Finish</div>
      </div>

      <div class="sim-main-grid">
        <section class="panel sim-code-panel">
          <div class="panel-head">
            <span>1. Source Code</span><span class="spacer"></span>
            <span class="badge badge-blue">one line at a time</span>
          </div>
          <div class="sim-code-scroll" id="code-scroll"><div id="code-lines"></div></div>
          <div class="legend">
            <span class="lg"><span class="sw sw-cur"></span>current</span>
            <span class="lg"><span class="sw sw-next"></span>next</span>
            <span class="lg"><span class="sw sw-exec"></span>already covered</span>
            <span class="lg"><span class="sw sw-todo"></span>not covered</span>
          </div>
        </section>

        <section class="sim-explain-stack">
          <div class="panel sim-focus-panel">
            <div class="panel-head">
              <span>2. Line Explanation</span><span class="spacer"></span>
              <span class="badge badge-teal" id="line-badge">Ready</span>
            </div>
            <div class="sim-focus-body" id="focus-body"></div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <span>3. Program State</span><span class="spacer"></span>
              <span class="badge badge-blue" id="state-tag">Initial</span>
            </div>
            <div class="state-grid" id="state-body"></div>
          </div>
        </section>
      </div>

      <section class="panel sim-output-panel">
        <div class="panel-head">
          <span>4. Output &amp; Step Result</span><span class="spacer"></span>
          <span class="badge badge-blue" id="result-badge">Waiting</span>
        </div>
        <div id="result-body"></div>
      </section>

      <div id="complete-area"></div>
    </div>`;

  const $ = id => container.querySelector('#' + id);
  const codeLinesEl = $('code-lines');
  const codeScroll = $('code-scroll');
  const focusBody = $('focus-body');
  const stateBody = $('state-body');
  const resultBody = $('result-body');
  const completeArea = $('complete-area');
  const pfill = $('sim-pbar').querySelector('.pfill');
  const counter = $('sim-counter');
  const status = $('sim-status');
  const lineBadge = $('line-badge');
  const stateTag = $('state-tag');
  const resultBadge = $('result-badge');
  const flowCurrent = $('flow-current');
  const flowNext = $('flow-next');

  const rowEls = [];
  codeHtml.forEach((html, i) => {
    const row = h(`<div class="code-line-v3" data-line="${i + 1}">
      <span class="ln">${i + 1}</span><span class="tx"></span><span class="row-state"></span></div>`);
    row.querySelector('.tx').innerHTML = html;
    codeLinesEl.appendChild(row);
    rowEls.push(row);
  });

  const cellLabel = key => {
    const cell = cellDefs.find(c => c.key === key);
    return cell?.label || key;
  };

  const fmt = value => {
    if (value === undefined) return '—';
    if (value === null) return 'null';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
  };

  const same = (a, b) => {
    try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
    catch (_) { return a === b; }
  };

  function stateHtml(state, changed) {
    const keys = Object.keys(state || {});
    if (!keys.length) return '<div class="muted small" style="padding:14px">No tracked variables for this practical.</div>';
    return keys.map(key => `<div class="cell ${changed.includes(key) ? 'flash-v3' : ''}">
      <div class="c-label">${esc(cellLabel(key))}</div>
      <div class="c-val">${esc(fmt(state[key]))}</div>
    </div>`).join('');
  }

  function deltaHtml(step) {
    if (!step) return '';
    const keys = [...new Set([...Object.keys(step.before || {}), ...Object.keys(step.after || {})])];
    const changed = keys.filter(k => !same(step.before?.[k], step.after?.[k]));
    if (!changed.length) return '<div class="no-change">No tracked state value changes on this line.</div>';
    return `<div class="delta-v3"><div class="delta-title">State changed on this line</div>
      ${changed.map(key => `<div class="delta-row"><span>${esc(cellLabel(key))}</span><code>${esc(fmt(step.before?.[key]))}</code><b>→</b><code>${esc(fmt(step.after?.[key]))}</code></div>`).join('')}
    </div>`;
  }

  function focusHtml(step, mode) {
    if (!step) return `<div class="empty-focus"><b>Start of practical</b><p>Press <b>Next</b> to begin with source line 1. You control every step.</p></div>`;
    const lineClass = mode === 'next' ? 'focus-next' : 'focus-current';
    return `<div class="focus-card ${lineClass}">
      <div class="focus-top"><span>${mode === 'next' ? 'NEXT LINE' : 'CURRENT LINE'}</span><b>Line ${step.line}</b></div>
      <pre class="focus-source">${esc(step.source || ' ')}</pre>
      <div class="focus-grid">
        <div><span class="ex-label what">WHAT</span><p>${esc(step.what || 'This line is part of the source walkthrough.')}</p></div>
        <div><span class="ex-label why">WHY</span><p>${esc(step.why || 'It contributes to the practical logic.')}</p></div>
        <div><span class="ex-label how">HOW</span><p>${esc(step.how || 'The program processes this line in the current context.')}</p></div>
        <div><span class="ex-label result">RESULT</span><p>${esc(step.result || 'The walkthrough advances to the next source line.')}</p></div>
      </div>
      ${step.semantic ? '<div class="semantic-note">Detailed runtime information from the practical data is attached to this line.</div>' : '<div class="walkthrough-note">This line did not have a separate runtime trace entry, so the simulator explains its role without inventing a hidden execution jump.</div>'}
      ${deltaHtml(step)}
    </div>`;
  }

  function render() {
    const current = engine.currentStep;
    const next = engine.nextStep;

    rowEls.forEach((row, index) => {
      const line = index + 1;
      const state = engine.lineState(line);
      row.className = 'code-line-v3 ' + state;
      const marker = row.querySelector('.row-state');
      marker.textContent = state === 'current' ? 'CURRENT' : state === 'next' ? 'NEXT' : state === 'done' ? 'DONE' : '';
    });

    counter.textContent = `Line ${engine.cursor} / ${engine.total}`;
    pfill.style.width = engine.total ? `${Math.round(engine.cursor / engine.total * 100)}%` : '0%';

    if (engine.autoRunning) status.textContent = 'Playing';
    else if (engine.done) status.textContent = 'Completed';
    else if (engine.cursor) status.textContent = 'Paused';
    else status.textContent = 'Ready';
    status.className = 'sim-status ' + status.textContent.toLowerCase();

    flowCurrent.textContent = current ? `Line ${current.line}` : 'Start';
    flowNext.textContent = next ? `Line ${next.line}` : engine.done ? 'End' : 'Line 1';

    if (engine.cursor === 0) {
      lineBadge.textContent = 'Next';
      focusBody.innerHTML = focusHtml(next, 'next');
      stateTag.textContent = 'Initial';
      resultBadge.textContent = 'Waiting';
      resultBody.innerHTML = `<div class="result-empty"><b>Console is ready.</b> Press <b>Next</b> and the simulator will show exactly what the current source line contributes to the program output.</div>
        <div class="record-hint-v3">The final record-ready answer appears after the complete walkthrough, so the student can see exactly what result to write.</div>`;
    } else {
      lineBadge.textContent = engine.done ? 'Complete' : 'Current';
      focusBody.innerHTML = focusHtml(current, 'current');
      stateTag.textContent = engine.done ? 'Final walkthrough state' : `After line ${current.line}`;
      const changed = engine.changedKeys();
      stateBody.innerHTML = stateHtml(engine.stateNow(), changed);

      const contribution = current?.output ? engine.normalizeOutput(current.output) : '';
      const accumulated = engine.outputSoFar();
      const finalAnswer = engine.finalOutput || practical.expectedOutput || '';
      const contributionHtml = contribution
        ? `<div class="output-box-v3 output-current-v3"><div class="output-title">This line produces</div><pre>${esc(contribution)}</pre></div>`
        : `<div class="result-empty">This source line does not print anything. The previous console output remains below.</div>`;
      const consoleHtml = accumulated
        ? `<div class="output-box-v3 output-console-v3"><div class="output-title">Console — output so far</div><pre>${esc(accumulated)}</pre></div>`
        : `<div class="output-box-v3 output-console-v3"><div class="output-title">Console — output so far</div><pre class="console-placeholder">(no output has been produced yet)</pre></div>`;
      const finalHtml = engine.done && finalAnswer
        ? `<div class="record-answer-v3"><div class="record-answer-head"><span>✓ FINAL ANSWER / RESULT</span><b>Write this in your practical record</b></div><pre>${esc(finalAnswer)}</pre></div>`
        : `<div class="record-hint-v3">Finish the complete walkthrough to reveal the final record-ready answer/output.</div>`;
      resultBadge.textContent = contribution ? 'Output produced' : 'Line processed';
      resultBody.innerHTML = `${contributionHtml}${consoleHtml}${finalHtml}
        <div class="result-source">${current.semantic ? '✓ Detailed practical trace available for this line.' : '• Walkthrough explanation only — no hidden jump is performed.'}</div>`;
    }

    if (engine.cursor === 0) stateBody.innerHTML = stateHtml(engine.stateNow(), []);

    $('btn-prev').disabled = engine.cursor === 0 || engine.autoRunning;
    $('btn-next').disabled = engine.done || engine.autoRunning;
    $('btn-play').disabled = engine.total === 0 || engine.autoRunning;
    $('btn-pause').disabled = !engine.autoRunning;
    $('btn-restart').disabled = engine.cursor === 0 && !engine.autoRunning;
    $('btn-finish').disabled = engine.done || engine.autoRunning;

    // Only scroll the simulator's CODE pane, never the whole page. This keeps
    // the learner's position stable while still revealing the current line.
    if (current && rowEls[current.line - 1] && !engine.autoRunning) revealCodeRow(rowEls[current.line - 1]);

    if (engine.done) renderComplete();
    else completeArea.innerHTML = '';
  }

  function revealCodeRow(row) {
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    const viewTop = codeScroll.scrollTop;
    const viewBottom = viewTop + codeScroll.clientHeight;
    const margin = 30;
    if (top < viewTop + margin) codeScroll.scrollTop = Math.max(0, top - margin);
    else if (bottom > viewBottom - margin) codeScroll.scrollTop = Math.max(0, bottom - codeScroll.clientHeight + margin);
  }

  function renderComplete() {
    const nextId = typeof opts.nextId === 'function' ? opts.nextId() : opts.nextId;
    const already = practical.progress?.completed;
    completeArea.innerHTML = `<div class="complete-card complete-v3">
      <div class="cc-ic">${I.check}</div>
      <div><h3>Complete source walkthrough</h3><p>All ${engine.total} source lines were covered in order. No line was silently skipped.</p></div>
      <div class="cc-actions">
        ${already ? '' : '<button class="btn btn-accent" id="btn-mark-complete">' + I.check + ' Mark Complete</button>'}
        ${nextId ? '<button class="btn btn-primary" id="btn-next-prac">Next Practical ' + I.next + '</button>' : ''}
      </div>
    </div>`;
    const mark = $('btn-mark-complete');
    if (mark) mark.onclick = () => opts.onComplete && opts.onComplete();
    const nextBtn = $('btn-next-prac');
    if (nextBtn) nextBtn.onclick = () => opts.onNextPractical && opts.onNextPractical();
  }

  function progress() {
    if (typeof opts.onProgress === 'function') opts.onProgress(engine.cursor, engine.done);
  }

  $('btn-next').onclick = () => { if (engine.next()) progress(); };
  $('btn-prev').onclick = () => { if (engine.prev()) progress(); };
  $('btn-play').onclick = () => engine.play();
  $('btn-pause').onclick = () => engine.pause();
  $('btn-restart').onclick = () => { engine.restart(); progress(); };
  $('btn-finish').onclick = () => { engine.finish(); progress(); };

  function keydown(event) {
    if (event.target.matches('input, textarea, select, button, a')) return;
    if (event.key === 'ArrowRight') { if (engine.next()) progress(); event.preventDefault(); }
    else if (event.key === 'ArrowLeft') { if (engine.prev()) progress(); event.preventDefault(); }
    else if (event.key === ' ') { engine.autoRunning ? engine.pause() : engine.play(); event.preventDefault(); }
    else if (event.key === 'Home') { engine.restart(); progress(); event.preventDefault(); }
    else if (event.key === 'End') { engine.finish(); progress(); event.preventDefault(); }
  }

  document.addEventListener('keydown', keydown);
  const unsubscribe = engine.on(render);
  render();

  return {
    root: container,
    render,
    destroy() {
      engine.cancelAuto(false);
      unsubscribe();
      document.removeEventListener('keydown', keydown);
      container.innerHTML = '';
    },
  };
}
