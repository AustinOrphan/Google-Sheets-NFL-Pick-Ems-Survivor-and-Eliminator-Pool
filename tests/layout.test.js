'use strict';

const { describe, it, assert } = require('./run.js');
const { load, APPS_SCRIPT_GLOBALS } = require('./harness.js');

const INSPECT = Symbol.for('nodejs.util.inspect.custom');

// Module-level helpers computeWeeklyLayout must never reach for - if it
// did, it would be reading/writing a live sheet's row/column count rather
// than computing geometry from its own arguments.
const MODULE_HELPER_NAMES = ['adjustRows', 'adjustColumns'];

// A property access, call, construction, or assignment on this raises
// immediately, unlike the harness's normal makeStub() (tests/harness.js),
// which silently swallows everything so top-level Apps Script calls in
// picks.gs don't crash the eval. Swapping the real Apps Script globals and
// module helpers for THIS stub during a single computeWeeklyLayout() call
// is what makes the "touches no sheet" test below an actual purity check:
// an impure call now throws instead of silently no-op'ing.
function makeThrowingStub(name) {
  const fail = (detail) => {
    throw new Error(`impure: computeWeeklyLayout touched ${name}${detail} - it must be a pure function of its arguments`);
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

const TEAMS = [
  ['BUF','NYJ'],['KC','LV'],['DAL','PHI'],['SF','SEA'],['GB','CHI'],['BAL','CIN'],
  ['MIA','NE'],['DET','MIN'],['HOU','IND'],['JAX','TEN'],['LAC','DEN'],['NO','ATL'],
  ['TB','CAR'],['PIT','CLE'],['LAR','ARI'],['WAS','NYG'],
];

function games() {
  return TEAMS.map(([away, home], i) => ({
    awayTeam: away, homeTeam: home,
    // last two are Monday evening -> MNF
    dayName: i >= 14 ? 'Monday' : (i < 2 ? 'Thursday' : 'Sunday'),
    hour: i >= 14 ? 20 : 13,
    spread: -3, bonus: 1,
  }));
}

function fixtures(over) {
  const o = over || {};
  const memberCount = o.memberCount === undefined ? 8 : o.memberCount;
  const members = {}; const memberOrder = [];
  for (let i = 1; i <= memberCount; i++) {
    memberOrder.push('m' + i);
    members['m' + i] = { name: 'Member ' + i };
  }
  return {
    week: 5,
    config: Object.assign({
      tiebreakerInclude: true, mnfExclude: false, commentsExclude: false,
      weeklyPaidTracking: true, bonusInclude: true, hideNonParticipants: false,
    }, o.config || {}),
    forms: { 5: { gamePlan: {
      games: games(), pickemsInclude: true,
      pickemsAts: o.pickemsAts === undefined ? true : o.pickemsAts,
    }, respondents: memberCount } },
    memberData: { members, memberOrder },
    observed: { displayEmpty: true, memberNames: null },
  };
}

function build(over) {
  const { computeWeeklyLayout } = load();
  const f = fixtures(over);
  return computeWeeklyLayout(f.week, f.config, f.forms, f.memberData, f.observed);
}

describe('computeWeeklyLayout', () => {

  it('every matchup descriptor has a distinct, ascending column', () => {
    const l = build();
    const cols = l.matchupDescriptors.map(d => d.col);
    assert.equal(new Set(cols).size, cols.length, 'duplicate columns: ' + cols.join(','));
    assert.deepEqual(cols, [...cols].sort((a, b) => a - b));
    assert.equal(cols[0], l.firstMatchupCol);
    assert.equal(cols[cols.length - 1], l.finalMatchupCol);
  });

  it('finalCol equals headers.length', () => {
    const l = build();
    assert.equal(l.finalCol, l.headers.length);
  });

  it('whole-row arrays are all the same length', () => {
    const l = build();
    const n = l.headers.length;
    assert.equal(l.subHeaders.length, n);
    assert.equal(l.widths.length, n);
    assert.equal(l.fontSizes.length, n);
    assert.equal(l.subFontSizes.length, n);
  });

  it('per-matchup arrays are matchups long, not finalCol long', () => {
    const l = build();
    assert.equal(l.spreads.length, l.matchups);
    assert.equal(l.bonuses.length, l.matchups);
  });

  it('rows equals bonusRow for every member count', () => {
    for (const n of [1, 2, 8, 25, 60]) {
      const l = build({ memberCount: n });
      assert.equal(l.rows, l.bonusRow, 'n=' + n);
      assert.equal(l.rows, l.summaryRow + 5, 'n=' + n);
      assert.equal(l.entryRowEnd, l.entryRowStart + n - 1, 'n=' + n);
    }
  });

  it('mnfCols holds exactly the Monday-evening columns', () => {
    const l = build();
    const expected = l.matchupDescriptors.filter(d => d.isMnf).map(d => d.col);
    assert.deepEqual(l.mnfCols, expected);
    assert.equal(l.mnfCols.length, 2);
  });

  it('returns null, not a throw, when the week has no gamePlan', () => {
    const { computeWeeklyLayout } = load();
    const f = fixtures();
    assert.equal(computeWeeklyLayout(9, f.config, f.forms, f.memberData, f.observed), null);
    assert.equal(computeWeeklyLayout(5, f.config, {}, f.memberData, f.observed), null);
    assert.equal(computeWeeklyLayout(5, f.config, undefined, f.memberData, f.observed), null);
  });

  it('observed.memberNames overrides memberData when provided', () => {
    const { computeWeeklyLayout } = load();
    const f = fixtures({ memberCount: 8 });
    const l = computeWeeklyLayout(5, f.config, f.forms, f.memberData,
      { displayEmpty: true, memberNames: ['Ann', 'Bob', 'Cy'] });
    assert.equal(l.totalMembers, 3);
    assert.deepEqual(l.members, [['Ann'], ['Bob'], ['Cy']]);
    assert.equal(l.entryRowEnd, l.entryRowStart + 2);
  });

  it('config flags move the right column indices', () => {
    const full = build();
    const noTie = build({ config: { tiebreakerInclude: false } });
    assert.ok(full.tiebreakerCol > 0);
    assert.equal(noTie.tiebreakerCol, -1);
    assert.equal(noTie.finalCol, full.finalCol - 2, 'tiebreaker adds 2 columns');

    const noMnf = build({ config: { mnfExclude: true } });
    assert.equal(noMnf.finalCol, full.finalCol - 1);

    const noComments = build({ config: { commentsExclude: true } });
    assert.equal(noComments.finalCol, full.finalCol - 1);

    const noPaid = build({ config: { weeklyPaidTracking: false } });
    assert.equal(noPaid.paidCheckboxes, false);
    assert.equal(noPaid.finalCol, full.finalCol - 1);
  });

  it('day colours come from the real palettes, keyed per matchup', () => {
    const { dayColorsObj, dayColorsFilledObj } = load();
    const l = build();
    for (const d of l.matchupDescriptors) {
      assert.equal(d.dayHeader, dayColorsObj[d.day]);
      assert.equal(d.dayFill, dayColorsFilledObj[d.day]);
    }
  });

  it('descriptor keys match newMatchupMap', () => {
    const l = build();
    for (const d of l.matchupDescriptors) {
      assert.equal(d.key, `${d.away} @ ${d.home}`);
      assert.ok(l.newMatchupMap[d.key] !== undefined);
    }
  });

  it('touches no sheet — pure given its arguments', () => {
    // Calling twice and deep-equaling the results (the previous version of
    // this test) does NOT prove purity: the harness's normal stubs
    // (tests/harness.js makeStub()) swallow every Apps Script call
    // silently, so an impure call - e.g. SpreadsheetApp.getActiveSheet()
    // .getRange(1,1).setValue(...) - neither throws nor changes the
    // returned layout object. This test instead swaps every Apps Script
    // global, PLUS the module-level adjustRows/adjustColumns helpers, for
    // a stub that throws on ANY access, then asserts computeWeeklyLayout
    // still completes normally and returns a real layout. Restored in
    // `finally` so later tests see the normal permissive stubs again.
    //
    // Logger is included in the throwing set (not kept permissive):
    // computeWeeklyLayout (picks.gs:9816-10080) contains no Logger.log
    // call, confirmed by inspection, so Logger.log is not a call this
    // function is expected to make.
    const { computeWeeklyLayout } = load();
    const throwingNames = [...APPS_SCRIPT_GLOBALS, ...MODULE_HELPER_NAMES];
    const saved = new Map(throwingNames.map(name => [name, globalThis[name]]));

    try {
      for (const name of throwingNames) globalThis[name] = makeThrowingStub(name);

      const f = fixtures();
      const l = computeWeeklyLayout(f.week, f.config, f.forms, f.memberData, f.observed);

      assert.ok(l, 'computeWeeklyLayout returned a falsy layout under throwing stubs');
      assert.ok(Array.isArray(l.headers) && l.headers.length > 0,
        'layout.headers looks incomplete under throwing stubs');
      assert.ok(Array.isArray(l.matchupDescriptors) && l.matchupDescriptors.length > 0,
        'layout.matchupDescriptors looks incomplete under throwing stubs');
    } finally {
      for (const [name, value] of saved) globalThis[name] = value;
    }
  });

  it('finalCol / headers / widths / subHeaders / fontSizes / subFontSizes stay in lockstep for every member count', () => {
    for (const n of [1, 2, 3, 8, 25, 60]) {
      const l = build({ memberCount: n });
      assert.equal(l.finalCol, l.headers.length, 'n=' + n + ' finalCol vs headers.length');
      assert.equal(l.headers.length, l.widths.length, 'n=' + n + ' headers.length vs widths.length');
      assert.equal(l.headers.length, l.subHeaders.length, 'n=' + n + ' headers.length vs subHeaders.length');
      assert.equal(l.headers.length, l.fontSizes.length, 'n=' + n + ' headers.length vs fontSizes.length');
      assert.equal(l.headers.length, l.subFontSizes.length, 'n=' + n + ' headers.length vs subFontSizes.length');
    }
  });

  it('a single-member layout has no cohesion column; a multi-member layout does', () => {
    const single = build({ memberCount: 1 });
    assert.equal(single.diffCol, -1, 'single-member diffCol should use the absent-column sentinel, like tiebreakerCol');

    const multi = build({ memberCount: 8 });
    assert.ok(multi.diffCol > 0, 'multi-member diffCol should point at a real column');
  });

  it('layout.notes carries the pointsCol/rankCol/percentCol/chancesCol header notes', () => {
    // pickemsAts pinned to false so chancesCol's config.pickemsAts branch is unambiguous here;
    // the config.pickemsAts vs. forms[week].gamePlan.pickemsAts (layout.isAts) split is a
    // separate, pre-existing question — see the task report.
    const withBonus = build({ config: { bonusInclude: true, pickemsAts: false } });
    const withoutBonus = build({ config: { bonusInclude: false, pickemsAts: false } });

    const findNote = (l, col) => l.notes.find(n => n.row === l.matchupRow && n.col === col);

    const pointsWith = findNote(withBonus, withBonus.pointsCol);
    const pointsWithout = findNote(withoutBonus, withoutBonus.pointsCol);
    assert.ok(pointsWith, 'missing pointsCol note (bonusInclude=true)');
    assert.ok(pointsWithout, 'missing pointsCol note (bonusInclude=false)');
    assert.equal(pointsWith.text, 'The number of correct points using bonus multipliers');
    assert.equal(pointsWithout.text, 'The current amount of correct picks on the week');
    assert.notEqual(pointsWith.text, pointsWithout.text);

    const rankNote = findNote(withBonus, withBonus.rankCol);
    assert.ok(rankNote, 'missing rankCol note');
    assert.equal(rankNote.text, 'Current weekly rank of each member');

    const percentWith = findNote(withBonus, withBonus.percentCol);
    const percentWithout = findNote(withoutBonus, withoutBonus.percentCol);
    assert.ok(percentWith, 'missing percentCol note (bonusInclude=true)');
    assert.ok(percentWithout, 'missing percentCol note (bonusInclude=false)');
    assert.equal(percentWith.text, 'Percent of picks correct (disregards bonus multipliers)');
    assert.equal(percentWithout.text, 'Percent of picks correct');
    assert.notEqual(percentWith.text, percentWithout.text);

    const chancesWith = findNote(withBonus, withBonus.chancesCol);
    assert.ok(chancesWith, 'missing chancesCol note');
    assert.equal(chancesWith.text, 'Chance to finish with the most points on the week');
  });
});
