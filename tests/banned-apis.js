'use strict';

const { load } = require('./harness.js');

const ENTRIES = ['applyWeeklyFormatting'];   // Task 11 appends applySimpleFormatting

const BANNED = [
  ['setValue',        /\.setValue\s*\(/],
  ['setValues',       /\.setValues\s*\(/],
  ['setFormula',      /\.setFormula\s*\(/],
  ['setFormulaR1C1',  /\.setFormulaR1C1\s*\(/],
  ['setFormulas',     /\.setFormulas\s*\(/],
  ['clear',           /\.clear\s*\(\s*\)/],
  ['clearContents',   /\.clearContents\s*\(/],
  ['insertCheckboxes',/\.insertCheckboxes\s*\(/],
  ['adjustRows',      /\badjustRows\s*\(/],
  ['adjustColumns',   /\badjustColumns\s*\(/],
  ['setNamedRange',   /\.setNamedRange\s*\(/],
];

const REQUIRED = [['clearFormat', /\.clearFormat\s*\(/]];

function declaredFunctionNames(src) {
  const names = new Set();
  for (const re of [
    /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/gm,
  ]) {
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

function bodyOf(src, name) {
  const re = new RegExp(
    `^(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`, 'm');
  const m = re.exec(src);
  if (!m) return null;
  const start = src.indexOf('{', m.index);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const src = load().__source;
const declared = declaredFunctionNames(src);
const problems = [];

for (const entry of ENTRIES) {
  const own = bodyOf(src, entry);
  if (own === null) { problems.push(`${entry}: not found in picks.gs`); continue; }

  for (const [label, re] of REQUIRED) {
    if (!re.test(own)) problems.push(`${entry}: MISSING required ${label}()`);
  }

  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const fname = queue.shift();
    const body = bodyOf(src, fname);
    if (body === null) continue;
    for (const [label, re] of BANNED) {
      if (re.test(body)) problems.push(`${entry} -> ${fname}: BANNED ${label}()`);
    }
    for (const name of declared) {
      if (!seen.has(name) && new RegExp(`\\b${name}\\s*\\(`).test(body)) {
        seen.add(name); queue.push(name);
      }
    }
  }
}

if (problems.length) {
  console.error('BANNED-API GATE FAILED');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`banned-api gate: clean (${ENTRIES.length} entry point(s))`);
