'use strict';

const { describe, it, assert } = require('./run.js');
const { load, APPS_SCRIPT_GLOBALS } = require('./harness.js');

const INSPECT = Symbol.for('nodejs.util.inspect.custom');

// Module-level helpers computeSimpleLayout must never reach for - if it did, it would be reading
// a live sheet's row/column count rather than computing geometry from its own arguments. Mirrors
// tests/layout.test.js's MODULE_HELPER_NAMES.
const MODULE_HELPER_NAMES = ['adjustRows', 'adjustColumns'];

// Same throwing-stub trick as tests/layout.test.js: a property access, call, construction or
// assignment on this raises immediately, unlike the harness's normal makeStub() (tests/harness.js),
// which silently swallows everything. Without this, a test that just calls computeSimpleLayout
// twice and diffs the results would assert nothing about purity - an impure call would neither
// throw nor change the returned layout under the permissive stubs.
function makeThrowingStub(name) {
  const fail = (detail) => {
    throw new Error(`impure: computeSimpleLayout touched ${name}${detail} - it must be a pure function of its arguments`);
  };
  return new Proxy(function throwingStub() {}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;          // never look thenable
      if (prop === INSPECT) return () => `[ThrowingStub ${name}]`;
      if (prop === 'toString') return () => `[ThrowingStub ${name}]`;
      if (typeof prop === 'symbol') return undefined;
      fail(`.${String(prop)}`);
    },
    apply() { fail('()'); },
    construct() { fail('(...) via new'); },
    set() { fail(' (assignment)'); },
  });
}

const SPEC_KEYS = ['TOT', 'RNK', 'PCT'];

function memberData(n) {
  const members = {};
  const memberOrder = [];
  for (let i = 1; i <= n; i++) {
    memberOrder.push('m' + i);
    members['m' + i] = { name: 'Member ' + i };
  }
  return { members, memberOrder };
}

describe('computeSimpleLayout', () => {

  it('touches no sheet, no PropertiesService/HtmlService, and no module row/column helpers — pure given its arguments', () => {
    // Logger is included in the throwing set (not kept permissive): computeSimpleLayout
    // (picks.gs:7294-7317) contains no Logger.log call, confirmed by inspection.
    const { computeSimpleLayout } = load();
    const throwingNames = [...APPS_SCRIPT_GLOBALS, ...MODULE_HELPER_NAMES];
    const saved = new Map(throwingNames.map(name => [name, globalThis[name]]));

    try {
      for (const name of throwingNames) globalThis[name] = makeThrowingStub(name);

      const md = memberData(8);
      for (const key of SPEC_KEYS) {
        const l = computeSimpleLayout(key, md);
        assert.ok(l, `computeSimpleLayout(${key}, ...) returned a falsy layout under throwing stubs`);
        assert.ok(Array.isArray(l.members) && l.members.length === 8,
          `layout.members looks incomplete under throwing stubs for ${key}`);
      }
    } finally {
      for (const [name, value] of saved) globalThis[name] = value;
    }
  });

  it('member row range, finalCol and row total stay internally consistent for every spec and member count', () => {
    const { computeSimpleLayout } = load();
    for (const key of SPEC_KEYS) {
      for (const n of [1, 3, 8, 25]) {
        const l = computeSimpleLayout(key, memberData(n));
        assert.equal(l.entryRowEnd, l.entryRowStart + n - 1, `${key} n=${n} entryRowEnd`);
        assert.equal(l.finalCol, l.weeks.length + 2, `${key} n=${n} finalCol vs. member+overall+week columns`);

        const expectedRows = l.spec.hasAvgRow ? n + 2 : n + 1;
        assert.equal(l.rows, expectedRows, `${key} n=${n} rows vs. hasAvgRow`);

        if (l.spec.hasAvgRow) {
          assert.equal(l.avgRow, l.entryRowEnd + 1, `${key} n=${n} avgRow should follow the last member row`);
        } else {
          assert.equal(l.avgRow, null, `${key} n=${n} avgRow should be absent`);
        }
      }
    }
  });

  it('hasAvgRow genuinely differentiates: RNK carries no averages row while TOT and PCT do', () => {
    const { computeSimpleLayout } = load();
    const n = 8;
    const tot = computeSimpleLayout('TOT', memberData(n));
    const rnk = computeSimpleLayout('RNK', memberData(n));
    const pct = computeSimpleLayout('PCT', memberData(n));

    assert.equal(tot.spec.hasAvgRow, true);
    assert.equal(rnk.spec.hasAvgRow, false);
    assert.equal(pct.spec.hasAvgRow, true);

    // Same member count and the same finalCol (both driven only by WEEKS/WEEKS_TO_EXCLUDE) -
    // the row-count gap below is caused by nothing but the trailing averages row.
    assert.equal(tot.finalCol, rnk.finalCol);
    assert.equal(rnk.finalCol, pct.finalCol);

    assert.equal(tot.rows, n + 2, 'TOT should include the averages row');
    assert.equal(pct.rows, n + 2, 'PCT should include the averages row');
    assert.equal(rnk.rows, n + 1, 'RNK should NOT include an averages row');
    assert.notEqual(rnk.rows, tot.rows, 'a naive shared layout would have flattened this difference away');

    assert.equal(rnk.avgRow, null);
    assert.notEqual(tot.avgRow, null);
    assert.notEqual(pct.avgRow, null);
  });

  it('carries sheetName and named-range names straight from SIMPLE_SHEET_SPECS, not derived from the key', () => {
    const { computeSimpleLayout, SIMPLE_SHEET_SPECS } = load();
    for (const key of SPEC_KEYS) {
      const l = computeSimpleLayout(key, memberData(5));
      const spec = SIMPLE_SHEET_SPECS[key];
      assert.equal(l.spec.sheetName, spec.sheetName, `${key} sheetName`);
      assert.equal(l.spec.namesRangeName, spec.namesRangeName, `${key} namesRangeName`);
      assert.equal(l.spec.overallRangeName, spec.overallRangeName, `${key} overallRangeName`);
      assert.equal(l.spec.weeklyRangeName, spec.weeklyRangeName, `${key} weeklyRangeName`);
    }

    // RNK's named ranges are TOT-prefixed, NOT RNK-prefixed. A "tidying" refactor that renamed
    // them to RNK_* would silently break every downstream INDIRECT formula on the season sheets.
    const rnk = computeSimpleLayout('RNK', memberData(5));
    assert.equal(rnk.spec.namesRangeName, 'TOT_OVERALL_RNK_NAMES');
    assert.equal(rnk.spec.overallRangeName, 'TOT_OVERALL_RANK');
    assert.equal(rnk.spec.weeklyRangeName, 'TOT_WEEKLY_RANK');
  });

  it('member names flow through in member order as an Nx1 array of arrays', () => {
    const { computeSimpleLayout } = load();
    const md = memberData(4);
    md.members.m3.name = 'Carol';   // out-of-alphabetical-order name to catch silent reordering/sorting
    for (const key of SPEC_KEYS) {
      const l = computeSimpleLayout(key, md);
      assert.equal(l.totalMembers, 4, `${key} totalMembers`);
      assert.deepEqual(l.members, [['Member 1'], ['Member 2'], ['Carol'], ['Member 4']], `${key} members`);
    }
  });
});
