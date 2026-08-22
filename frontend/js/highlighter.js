// Lightweight, dependency-free syntax highlighter.
// Produces per-line HTML so the simulator can render line states.
// Supported: LEX (flex), C/C++, Python, 8085/8086-style assembly, plain text.

import { esc } from './ui.js';

const C_KEYWORDS = /\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while)\b/;
const C_FUNCS = /\b(?:printf|scanf|yylex|yywrap|strlen|strcpy|strcmp|fprintf|sprintf|malloc|free|getchar|putchar|fopen|fclose|exit|main)\b/;

const C_PATTERNS = [
  [/\/\/[^\n]*/, 'tok-com'],
  [/"(?:[^"\\\n]|\\.)*"/, 'tok-str'],
  [/'(?:[^'\\\n]|\\.)*'/, 'tok-str'],
  [C_KEYWORDS, 'tok-kw'],
  [/^#\s*[a-z]+/, 'tok-dir'],
  [C_FUNCS, 'tok-fn'],
  [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'tok-num'],
  [/[+\-*/%=<>!&|^~]+/, 'tok-op'],
  [/[(){}\[\];,.:?]/, 'tok-op'],
];

const PY_PATTERNS = [
  [/#[^\n]*/, 'tok-com'],
  [/"""(?:[^"\\]|\\.)*?"""|'''(?:[^'\\]|\\.)*?'''/, 'tok-str'],
  [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/, 'tok-str'],
  [/\b(?:def|return|if|elif|else|for|while|in|not|and|or|import|from|as|class|try|except|finally|with|lambda|pass|break|continue|global|None|True|False|print|range|len|str|int|float|input|open|is)\b/, 'tok-kw'],
  [/\b\d+(?:\.\d+)?\b/, 'tok-num'],
  [/[+\-*/%=<>!&|^~]+/, 'tok-op'],
];

const ASM_PATTERNS = [
  [/;[^\n]*/, 'tok-com'],
  [/[;][^\n]*/, 'tok-com'],
  [/\b(?:ORG|DB|DS|DW|EQU|END|MACRO|ENDM|SEGMENT|ENDS|PROC|ENDP|ASSUME)\b/i, 'tok-dir'],
  [/\b(?:MOV|MVI|LXI|LDA|STA|LDAX|STAX|ADD|ADI|SUB|SUI|INR|DCR|INX|DCX|DAD|CMP|CPI|ANA|ANI|ORA|ORI|XRA|XRI|RAL|RAR|RLC|RRC|CMA|CMC|STC|JMP|JNZ|JZ|JC|JNC|JP|JM|JPE|JPO|CALL|CC|CNC|RET|PUSH|POP|XTHL|SPHL|PCHL|HLT|NOP|RIM|SIM|EI|DI|IN|OUT|DAA|DAD)\b/i, 'tok-mne'],
  [/\b[A-F0-9]{1,4}H\b/i, 'tok-num'],
  [/\b\d+\b/, 'tok-num'],
  [/\b(?:A|B|C|D|E|H|L|M|SP|PSW)\b/i, 'tok-reg'],
];

const LEX_PAT_PATTERNS = [
  [/\/\/[^\n]*/, 'tok-com'],
  [/\[[^\]]*\]/, 'tok-num'],
  [/"(?:[^"\\\n]|\\.)*"/, 'tok-str'],
  [/\\[nNtTrRbfl0]/, 'tok-str'],
  [/[|+*?()^$.]/, 'tok-op'],
  [/\{/, 'tok-op'],
];

function hl(text, patterns) {
  let out = '';
  let last = 0;
  const combined = patterns.map(p => p[0].source).join('|');
  const re = new RegExp(combined, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    let cls = 'tok-op';
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) { cls = patterns[i - 1][1]; break; }
    }
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  out += esc(text.slice(last));
  return out;
}

/** Split C code into [block-comment-free segments, comment segments]. */
function splitCComments(code) {
  const parts = [];
  let rest = code;
  const re = /\/\*[\s\S]*?\*\//g;
  let last = 0, m;
  while ((m = re.exec(rest)) !== null) {
    if (m.index > last) parts.push({ text: rest.slice(last, m.index), comment: false });
    parts.push({ text: m[0], comment: true });
    last = m.index + m[0].length;
  }
  if (last < rest.length) parts.push({ text: rest.slice(last), comment: false });
  if (parts.length === 0) parts.push({ text: code, comment: false });
  return parts;
}

/** Highlight C-like code, return array of per-line HTML. */
function hlC(code) {
  const lines = [];
  for (const part of splitCComments(code)) {
    const partLines = part.text.split('\n');
    partLines.forEach((ln, i) => {
      lines.push(part.comment ? `<span class="tok-com">${esc(ln)}</span>` : hl(ln, C_PATTERNS));
    });
  }
  // splitCComments keeps newlines inside parts; handle trailing empty line
  return lines;
}

/** Highlight LEX (.l) code, return array of per-line HTML. */
function hlLex(code) {
  const srcLines = code.split('\n');
  const out = [];
  let inDefs = false;
  let section = 'defs'; // defs -> rules -> user
  let rulesStarted = false;

  for (const ln of srcLines) {
    const t = ln.trim();

    if (t.startsWith('%{')) { inDefs = true; out.push(`<span class="tok-dir">${esc(ln)}</span>`); continue; }
    if (t === '%}') { inDefs = false; out.push(`<span class="tok-dir">${esc(ln)}</span>`); continue; }
    if (t === '%%') {
      if (!rulesStarted) { rulesStarted = true; section = 'rules'; }
      else { section = 'user'; }
      out.push(`<span class="tok-dir">${esc(ln)}</span>`);
      continue;
    }

    if (section === 'defs' || section === 'user') {
      out.push(hl(ln, C_PATTERNS));
      continue;
    }

    // rules section: pattern { action }
    if (t === '' || t.startsWith('//')) { out.push(esc(ln)); continue; }
    const brace = ln.indexOf('{');
    if (brace === -1) {
      out.push(hl(ln, LEX_PAT_PATTERNS));
      continue;
    }
    const pattern = ln.slice(0, brace);
    const action = ln.slice(brace); // includes trailing }
    out.push(hl(pattern, LEX_PAT_PATTERNS) + '<span class="tok-op">{</span>' + hl(action.slice(1, -1), C_PATTERNS) + '<span class="tok-op">}</span>');
  }
  return out;
}

/** Highlight assembly (8085/8086 style), per-line HTML. */
function hlAsm(code) {
  return code.split('\n').map(ln => hl(ln, ASM_PATTERNS));
}

/**
 * Highlight source code; returns array of per-line HTML strings.
 * @param {string} code
 * @param {string} lang
 */
export function highlightCode(code, lang = '') {
  const l = (lang || '').toLowerCase();
  if (l.includes('lex') || l.includes('flex') || l.includes('yacc') || l.includes('bison')) return hlLex(code);
  if (l.includes('python')) return code.split('\n').map(ln => hl(ln, PY_PATTERNS));
  if (l.includes('asm') || l.includes('assembly') || l.includes('8085') || l.includes('8086') || l.includes('8051')) return hlAsm(code);
  if (l.includes('c') || l.includes('java') || l.includes('javascript') || l.includes('php') || l.includes('c++')) return hlC(code);
  return code.split('\n').map(ln => esc(ln));
}
