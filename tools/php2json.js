#!/usr/bin/env node
/**
 * php2json.js — converts the PHP array seed files (manual_part1.php, manual_part2.php)
 * into a single JSON seed file with EXACT PHP semantics:
 *   - single-quoted strings (\\ and \' escapes only)
 *   - double-quoted strings (full PHP escape set: \n \t \\ \" \$ \xHH \u{} …)
 *   - nowdoc heredocs <<<'CODE' ... CODE (literal content)
 *   - associative arrays ([k => v]) → objects, list arrays → arrays
 *   - mk(...) / mk2(...) step-builder calls → step objects
 *
 * Usage: node tools/php2json.js backend/seed/manual_part1.php backend/seed/manual_part2.php
 * Output: data/seed/practicals.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

function convertFile(file) {
  let src = fs.readFileSync(file, 'utf8');

  // strip PHP open tag
  src = src.replace(/^\s*<\?php/, '');

  // strip comments (block + line), but not inside strings: do it during tokenizing instead
  // so here we only cut the function definition and the "return" keyword.
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  src = src.replace(/^function\s+(mk|mk2)\s*\([\s\S]*?\n\}\n/gm, ' ');
  src = src.replace(/\breturn\s+/, '');
  src = src.replace(/;\s*$/, '');

  let i = 0;
  const n = src.length;

  function skipWs() {
    while (i < n) {
      if (/\s/.test(src[i])) { i++; continue; }
      // line comment at token level (never inside strings/heredocs)
      if (src[i] === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      break;
    }
  }

  function parseStringSingle() {
    const start = i;
    i++; // opening quote
    let out = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\' && (src[i + 1] === "'" || src[i + 1] === '\\')) {
        out += src[i + 1]; i += 2; continue;
      }
      if (c === "'") { i++; return out; }
      out += c; i++;
    }
    throw new Error('unterminated single-quoted string started at ' + start + ' (i=' + i + ') near ' + JSON.stringify(src.slice(Math.max(0, start - 40), start + 40)));
  }

  function parseStringDouble() {
    i++;
    let out = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        const e = src[i + 1];
        const map = { n: '\n', t: '\t', r: '\r', v: '\v', f: '\f', e: '\x1b', '\\': '\\', '"': '"', $: '$' };
        if (e in map) { out += map[e]; i += 2; continue; }
        if (e === 'x') {
          const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i + 2));
          if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue; }
        }
        if (/^[0-7]{1,3}/.test(src.slice(i + 1))) {
          const m = /^[0-7]{1,3}/.exec(src.slice(i + 1));
          out += String.fromCharCode(parseInt(m[0], 8)); i += 1 + m[0].length; continue;
        }
        out += e; i += 2; continue;
      }
      if (c === '"') { i++; return out; }
      out += c; i++;
    }
    throw new Error('unterminated double-quoted string');
  }

  function parseHeredoc() {
    // <<<'CODE'\n ... \nCODE
    const m = /^<<<'([A-Za-z_][A-Za-z0-9_]*)'/.exec(src.slice(i));
    if (!m) throw new Error('bad heredoc at ' + i);
    const id = m[1];
    i += m[0].length;
    if (src[i] === '\n') i++; else if (src[i] === '\r' && src[i + 1] === '\n') i += 2;
    const start = i;
    // find closing marker line: \n<id> followed by non-identifier char
    const re = new RegExp('\\n' + id + '(?=[^A-Za-z0-9_])');
    const m2 = re.exec(src.slice(start));
    if (!m2) throw new Error('unterminated heredoc ' + id);
    const end = start + m2.index;
    i = start + m2.index + 1 + id.length; // past marker start (leave trailing chars)
    let content = src.slice(start, end);
    return content;
  }

  function parseNumber() {
    const m = /^-?\d+/.exec(src.slice(i));
    i += m[0].length;
    return parseInt(m[0], 10);
  }

  /** Parse any PHP function call on the global source: returns the ARG values. */
  function parseCallArgs(name) {
    // name( ... )  — collect balanced content, split top-level commas
    i += name.length;
    skipWs();
    if (src[i] !== '(') throw new Error('expected ( after ' + name);
    i++;
    const parts = [];
    let depth = 0, cur = '';
    while (i < n) {
      const c = src[i];
      // escaped quote / backslash inside a raw arg region
      if (c === '\\' && (src[i + 1] === "'" || src[i + 1] === '"' || src[i + 1] === '\\')) {
        cur += c + src[i + 1]; i += 2; continue;
      }
      if (c === "'") { cur += consumeRawString('\''); continue; }
      if (c === '"') { cur += consumeRawString('"'); continue; }
      if (c === '<') {
        // heredoc inside call args (shouldn't happen, but be safe)
        const hm = /^<<<'([A-Za-z_][A-Za-z0-9_]*)'/.exec(src.slice(i));
        if (hm) {
          const save = i;
          parseHeredoc();
          cur += src.slice(save, i);
          continue;
        }
      }
      if (c === ')' && depth === 0) { parts.push(cur); i++; break; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) { parts.push(cur); cur = ''; i++; continue; }
      cur += c; i++;
    }
    return parts.map(p => parseSub(p));
  }

  function consumeRawString(q) {
    const start = i;
    if (q === "'") { parseStringSingle(); } else { parseStringDouble(); }
    return src.slice(start, i);
  }

  // Parse a small standalone value string (used for call args).
  function parseSub(s) {
    let j = 0;
    function ws() { while (j < s.length && /\s/.test(s[j])) j++; }
    function val() {
      ws();
      const c = s[j];
      if (c === "'") {
        j++;
        let out = '';
        while (j < s.length) {
          if (s[j] === '\\' && (s[j + 1] === "'" || s[j + 1] === '\\')) { out += s[j + 1]; j += 2; continue; }
          if (s[j] === "'") { j++; return out; }
          out += s[j++];
        }
        throw new Error('bad arg string');
      }
      if (c === '"') {
        j++;
        let out = '';
        while (j < s.length) {
          if (s[j] === '\\') {
            const e = s[j + 1];
            const map = { n: '\n', t: '\t', r: '\r', v: '\v', f: '\f', e: '\x1b', '\\': '\\', '"': '"', $: '$' };
            if (e in map) { out += map[e]; j += 2; continue; }
            out += e; j += 2; continue;
          }
          if (s[j] === '"') { j++; return out; }
          out += s[j++];
        }
        throw new Error('bad arg dstring');
      }
      if (c === '[') {
        return parseArraySub(s, (jj) => { j = jj; });
      }
      if (c === '-' || /\d/.test(c)) {
        const m = /^-?\d+/.exec(s.slice(j));
        j += m[0].length;
        return parseInt(m[0], 10);
      }
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(j));
      if (m) {
        j += m[0].length;
        if (m[0] === 'json_encode') {
          ws();
          if (s[j] === '(') {
            let d = 0, k = j;
            for (; k < s.length; k++) {
              const ch = s[k];
              if (ch === "'" || ch === '"') {
                // skip string
                const q = ch; k++;
                while (k < s.length) {
                  if (s[k] === '\\' && k + 1 < s.length) { k += 2; continue; }
                  if (s[k] === q) break;
                  k++;
                }
                continue;
              }
              if (ch === '(' || ch === '[') d++;
              if (ch === ')' || ch === ']') d--;
              if (ch === ')' && d === 0) break;
            }
            const inner = s.slice(j + 1, k);
            j = k + 1;
            const v = parseSub(inner);
            return JSON.stringify(v);
          }
        }
        return m[0];
      }
      throw new Error('bad arg token ' + c);
    }
    function parseArraySub(s, setPos) {
      j++; // [
      const obj = {};
      const arr = [];
      let isObj = false;
      while (true) {
        ws();
        if (s[j] === ']') { j++; break; }
        // key?
        const save = j;
        const k = val();
        ws();
        if (s[j] === '=' && s[j + 1] === '>') {
          isObj = true;
          j += 2;
          const v = val();
          obj[String(k)] = v;
        } else {
          j = save;
          arr.push(val());
        }
        ws();
        if (s[j] === ',') { j++; continue; }
        if (s[j] === ']') { j++; break; }
        throw new Error('bad array at ' + j);
      }
      setPos(j);
      return isObj ? obj : arr;
    }
    const r = val();
    ws();
    return r;
  }

  function parseValue() {
    skipWs();
    const c = src[i];
    if (c === "'") return parseStringSingle();
    if (c === '"') return parseStringDouble();
    if (c === '<') return parseHeredoc();
    if (c === '[') {
      i++;
      const obj = {};
      const arr = [];
      let isObj = false;
      while (true) {
        skipWs();
        if (src[i] === ']') { i++; break; }
        const save = i;
        const k = parseValue();
        skipWs();
        if (src[i] === '=' && src[i + 1] === '>') {
          isObj = true;
          i += 2;
          const v = parseValue();
          obj[String(k)] = v;
        } else {
          i = save;
          arr.push(parseValue());
        }
        skipWs();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; break; }
        throw new Error('bad array at ' + i + ' near ' + JSON.stringify(src.slice(Math.max(0, i - 120), i + 30)));
      }
      return isObj ? obj : arr;
    }
    if (c === '-' || /\d/.test(c)) return parseNumber();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (m) {
      const id = m[0];
      if (id === 'true') { i += 4; return true; }
      if (id === 'false') { i += 5; return false; }
      if (id === 'null') { i += 4; return null; }
      if (id === 'mk' || id === 'mk2') {
        const a = parseCallArgs(id);
        return {
          line: a[0], what: a[1], why: a[2], how: a[3],
          result: a[4], before: a[5], after: a[6], output: a[7],
        };
      }
      if (id === 'json_encode') {
        const a = parseCallArgs(id);
        return JSON.stringify(a[0]);
      }
      throw new Error('unexpected identifier ' + id + ' at ' + i);
    }
    throw new Error('unexpected char ' + c + ' at ' + i);
  }

  const result = parseValue();
  return result;
}

// ---------------- main ----------------
const files = process.argv.slice(2);
if (files.length < 1) {
  console.error('usage: node tools/php2json.js <file.php> [more.php...]');
  process.exit(1);
}
const all = [];
for (const f of files) {
  const v = convertFile(f);
  if (!Array.isArray(v)) { console.error('expected array from ' + f); process.exit(1); }
  all.push(...v);
  console.error(`parsed ${f} → ${v.length} practicals`);
}

const outDir = path.join(__dirname, '..', 'data', 'seed');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'practicals.json');
fs.writeFileSync(outFile, JSON.stringify({ practicals: all }, null, 1));
console.log(`wrote ${outFile} (${fs.statSync(outFile).size} bytes, ${all.length} practicals)`);

// quick validation report
for (const p of all) {
  const lines = (p.sourceCode.match(/\n/g) || []).length + 1;
  const steps = (p.simulationData && p.simulationData.steps) ? p.simulationData.steps.length : 0;
  const maxLine = steps ? Math.max(...p.simulationData.steps.map(s => s.line)) : 0;
  console.log(`P${String(p.practicalNumber).padStart(2, '0')}: ${lines} src lines, ${steps} steps, maxStepLine=${maxLine} ${maxLine <= lines ? 'OK' : '*** OVERRUN ***'}`);
}
