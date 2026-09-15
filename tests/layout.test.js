'use strict';

const { describe, it, assert } = require('./run.js');
const { load } = require('./harness.js');

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
    const a = build();
    const b = build();
    assert.deepEqual(a.headers, b.headers);
    assert.deepEqual(a.matchupDescriptors.map(d => d.col), b.matchupDescriptors.map(d => d.col));
  });
});
