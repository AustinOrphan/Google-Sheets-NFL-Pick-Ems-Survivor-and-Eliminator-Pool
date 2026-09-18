'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PICKS_PATH = path.join(__dirname, '..', 'picks.gs');
const EXPORT_KEY = '__x';

const APPS_SCRIPT_GLOBALS = [
  'SpreadsheetApp', 'PropertiesService', 'Logger', 'HtmlService', 'DriveApp',
  'UrlFetchApp', 'Utilities', 'FormApp', 'ScriptApp', 'Session',
  'CacheService', 'LockService',
];

const INSPECT = Symbol.for('nodejs.util.inspect.custom');

// Chainable stand-in for an Apps Script global. picks.gs runs
// FormApp.createTextValidation()...build() at top level, so the stubs must
// already chain before the eval, not lazily.
function makeStub(name) {
  const memo = new Map();
  return new Proxy(function stub() {}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;          // never look thenable
      if (prop === 'toString') return () => `[AppsScriptStub ${name}]`;
      if (prop === INSPECT) return () => `[AppsScriptStub ${name}]`;
      if (typeof prop === 'symbol') return undefined;
      if (!memo.has(prop)) memo.set(prop, makeStub(`${name}.${String(prop)}`));
      return memo.get(prop);
    },
    apply() { return makeStub(`${name}()`); },
    construct() { return makeStub(`new ${name}()`); },
    set() { return true; },                            // swallow implicit-global writes
  });
}

// Generated, never hardcoded — see the note in the task header.
function topLevelNames(source) {
  const names = new Set();
  const fn = /^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;
  const decl = /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm;
  let m;
  while ((m = fn.exec(source)) !== null) names.add(m[1]);
  while ((m = decl.exec(source)) !== null) names.add(m[1]);
  return [...names].sort();   // Set dedupes: updateScheduleData is declared twice
}

let cached = null;

function load(options) {
  const opts = options || {};
  if (cached && !opts.fresh) return cached;

  const source = fs.readFileSync(PICKS_PATH, 'utf8');
  const names = topLevelNames(source);
  const shim = `\n;globalThis[${JSON.stringify(EXPORT_KEY)}] = { ${names.join(', ')} };\n`;

  for (const name of APPS_SCRIPT_GLOBALS) globalThis[name] = makeStub(name);

  const indirectEval = eval;
  indirectEval(source + shim);

  const exported = globalThis[EXPORT_KEY];
  if (!exported) throw new Error('export shim did not run');
  cached = Object.freeze({ ...exported, __names: names, __source: source });
  return cached;
}

module.exports = { load, makeStub, topLevelNames, PICKS_PATH, APPS_SCRIPT_GLOBALS };
