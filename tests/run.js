'use strict';

const assert = require('node:assert/strict');

const suites = [];
let current = null;

function describe(name, body) {
  current = { name, tests: [] };
  suites.push(current);
  body();
  current = null;
}

function it(name, body) {
  if (!current) throw new Error('it() outside describe()');
  current.tests.push({ name, body });
}

function runAll() {
  let pass = 0, fail = 0;
  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const t of suite.tests) {
      try {
        t.body();
        console.log(`  PASS  ${t.name}`);
        pass++;
      } catch (e) {
        console.log(`  FAIL  ${t.name}\n        ${e.message}`);
        fail++;
      }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}

module.exports = { describe, it, assert, runAll };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
    require(path.join(__dirname, f));
  }
  process.exit(runAll() === 0 ? 0 : 1);
}
