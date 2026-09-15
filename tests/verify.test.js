'use strict';

const { describe, it, assert } = require('./run.js');
const { load } = require('./harness.js');

const { weeklySheetPrefix } = load();

function shapeFor(layout, over) {
  return Object.assign({
    sheetExists: true,
    maxRows: layout.rows,
    maxCols: layout.finalCol,
    headerRow: layout.headers.slice(),
    namesExists: true,
    namesStartRow: layout.entryRowStart,
    namesNumRows: layout.totalMembers,
    namesValues: layout.members.map(r => r[0]),
    namesSheetName: `${weeklySheetPrefix}${layout.week}`,
  }, over || {});
}

describe('normalizeHeader', () => {
  it('collapses the AWAY\\n@HOME newline and trims', () => {
    const { normalizeHeader } = load();
    assert.equal(normalizeHeader('KC\n@BUF'), normalizeHeader('KC @BUF'));
    assert.equal(normalizeHeader('  KC\n@BUF  '), normalizeHeader('KC @BUF'));
    assert.equal(normalizeHeader('KC\r\n@BUF'), normalizeHeader('KC @BUF'));
  });

  it('does not equate genuinely different matchups', () => {
    const { normalizeHeader } = load();
    assert.notEqual(normalizeHeader('KC\n@BUF'), normalizeHeader('BUF\n@KC'));
  });

  it('handles non-string cells without throwing', () => {
    const { normalizeHeader } = load();
    assert.equal(normalizeHeader(null), '');
    assert.equal(normalizeHeader(undefined), '');
    assert.equal(normalizeHeader(5), '5');
  });
});

describe('compareWeeklyLayout', () => {
  const { computeWeeklyLayout, compareWeeklyLayout } = load();

  function layout() {
    const members = {}; const order = [];
    for (let i = 1; i <= 6; i++) { order.push('m' + i); members['m' + i] = { name: 'M' + i }; }
    return computeWeeklyLayout(5,
      { tiebreakerInclude: true, mnfExclude: false, commentsExclude: false, weeklyPaidTracking: true },
      { 5: { gamePlan: { games: [
          { awayTeam: 'KC', homeTeam: 'BUF', dayName: 'Sunday', hour: 13, spread: -3, bonus: 1 },
          { awayTeam: 'SF', homeTeam: 'SEA', dayName: 'Monday', hour: 20, spread: -1, bonus: 1 },
        ], pickemsInclude: true, pickemsAts: true }, respondents: 6 } },
      { members, memberOrder: order },
      { displayEmpty: true, memberNames: null });
  }

  it('passes a sheet that matches', () => {
    const l = layout();
    const r = compareWeeklyLayout(l, shapeFor(l));
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'ready');
  });

  it('reports no-sheet', () => {
    const l = layout();
    const r = compareWeeklyLayout(l, shapeFor(l, { sheetExists: false }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-sheet');
  });

  it('reports row-mismatch and col-mismatch distinctly', () => {
    const l = layout();
    assert.equal(compareWeeklyLayout(l, shapeFor(l, { maxRows: l.rows + 1 })).reason, 'row-mismatch');
    assert.equal(compareWeeklyLayout(l, shapeFor(l, { maxCols: l.finalCol + 1 })).reason, 'col-mismatch');
  });

  it('reports drift when a matchup header changed', () => {
    const l = layout();
    const hdr = l.headers.slice();
    hdr[l.firstMatchupCol - 1] = 'DEN\n@LV';
    const r = compareWeeklyLayout(l, shapeFor(l, { headerRow: hdr }));
    assert.equal(r.reason, 'drift');
    assert.match(r.detail, /Deploy/);          // remedy is in the message
  });

  it('accepts a header that differs only by newline or whitespace', () => {
    const l = layout();
    const hdr = l.headers.map(h => String(h).replace('\n', ' ') + '  ');
    assert.equal(compareWeeklyLayout(l, shapeFor(l, { headerRow: hdr })).ok, true);
  });

  it('reports names-mismatch for a blank row inside NAMES', () => {
    const l = layout();
    const v = l.members.map(r => r[0]); v[2] = '';
    const r = compareWeeklyLayout(l, shapeFor(l, { namesValues: v }));
    assert.equal(r.reason, 'names-mismatch');
  });

  it('reports names-mismatch when the roster disagrees with the sheet', () => {
    const l = layout();
    const v = l.members.map(r => r[0]); v[0] = 'Somebody Else';
    const r = compareWeeklyLayout(l, shapeFor(l, { namesValues: v }));
    assert.equal(r.reason, 'names-mismatch');
  });

  it('reports names-mismatch when NAMES starts on the wrong row', () => {
    const l = layout();
    const r = compareWeeklyLayout(l, shapeFor(l, { namesStartRow: l.entryRowStart + 1 }));
    assert.equal(r.reason, 'names-mismatch');
  });

  it('passes when namesSheetName matches the sheet under test', () => {
    const l = layout();
    const r = compareWeeklyLayout(l, shapeFor(l, { namesSheetName: `${weeklySheetPrefix}${l.week}` }));
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'ready');
  });

  it('reports names-mismatch when NAMES_{week} points at a different sheet', () => {
    const l = layout();
    const r = compareWeeklyLayout(l, shapeFor(l, { namesSheetName: 'Some Other Sheet' }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'names-mismatch');
    assert.ok(r.detail && r.detail.length > 10);
    assert.match(r.detail, /NAMES_5/);
  });

  it('every failure carries a non-empty detail', () => {
    const l = layout();
    for (const over of [{ sheetExists: false }, { maxRows: 99 }, { maxCols: 99 },
                        { namesExists: false }, { namesStartRow: 99 }]) {
      const r = compareWeeklyLayout(l, shapeFor(l, over));
      assert.equal(r.ok, false);
      assert.ok(r.detail && r.detail.length > 10, JSON.stringify(over));
    }
  });
});
