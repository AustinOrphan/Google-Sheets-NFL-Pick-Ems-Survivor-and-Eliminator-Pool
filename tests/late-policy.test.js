'use strict';

const { describe, it, assert } = require('./run');
const { load } = require('./harness');

describe('findTimestampColumn', () => {
  it('finds a header named Timestamp regardless of case or padding', () => {
    const { findTimestampColumn } = load();
    assert.equal(findTimestampColumn([' TIMESTAMP ', 'Select Your Name'], null), 0);
  });

  it('finds it when it is not the first column', () => {
    const { findTimestampColumn } = load();
    assert.equal(findTimestampColumn(['Select Your Name', 'Timestamp'], null), 1);
  });

  it('falls back to column 0 only when that column holds a Date', () => {
    const { findTimestampColumn } = load();
    const row = [new Date(2026, 8, 18), 'Alice'];
    assert.equal(findTimestampColumn(['Submitted', 'Select Your Name'], row), 0);
  });

  it('returns -1 when there is no Timestamp header and column 0 is a string', () => {
    const { findTimestampColumn } = load();
    assert.equal(findTimestampColumn(['Submitted', 'Select Your Name'], ['x', 'Alice']), -1);
  });

  it('returns -1 on an empty header row', () => {
    const { findTimestampColumn } = load();
    assert.equal(findTimestampColumn([], null), -1);
  });
});

describe('resolveLatePolicy', () => {
  it('passes through each known policy', () => {
    const { resolveLatePolicy, LATE_POLICIES } = load();
    LATE_POLICIES.forEach(p => assert.equal(resolveLatePolicy(p), p));
  });

  it('resolves an unknown value to none', () => {
    const { resolveLatePolicy } = load();
    assert.equal(resolveLatePolicy('kickoffLock'), 'none');
  });

  it('resolves undefined to none, so an un-upgraded pool is unchanged', () => {
    const { resolveLatePolicy } = load();
    assert.equal(resolveLatePolicy(undefined), 'none');
  });
});

describe('parseAllPicksFromSheet asOf cutoff', () => {
  const THU = new Date(Date.UTC(2026, 8, 17, 12, 0, 0));   // Thursday
  const SUN = new Date(Date.UTC(2026, 8, 20, 21, 0, 0));   // Sunday afternoon

  const HEADERS = ['Timestamp', 'Select Your Name', 'KC at BUF'];
  const memberData = { members: { m1: { name: 'Alice' } }, memberOrder: ['m1'] };

  // Two submissions from the same member: Thursday picks KC, Sunday switches to BUF.
  const fakeSheet = (rows) => ({
    getName: () => 'WK1',
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  });
  const rows = () => [
    HEADERS,
    [THU, 'Alice', 'KC'],
    [SUN, 'Alice', 'BUF'],
  ];

  it('with no cutoff, the latest submission wins (today\'s behavior)', () => {
    const { parseAllPicksFromSheet } = load();
    const picks = parseAllPicksFromSheet(fakeSheet(rows()), memberData);
    assert.equal(picks.m1.pickem['KC at BUF'], 'BUF');
  });

  it('a cutoff before the second submission returns the first', () => {
    const { parseAllPicksFromSheet } = load();
    const cutoff = SUN.getTime() - 1000;
    const picks = parseAllPicksFromSheet(fakeSheet(rows()), memberData, cutoff);
    assert.equal(picks.m1.pickem['KC at BUF'], 'KC');
  });

  it('a cutoff after the second submission returns the second', () => {
    const { parseAllPicksFromSheet } = load();
    const cutoff = SUN.getTime() + 1000;
    const picks = parseAllPicksFromSheet(fakeSheet(rows()), memberData, cutoff);
    assert.equal(picks.m1.pickem['KC at BUF'], 'BUF');
  });

  it('a cutoff exactly at a submission time includes that submission (inclusive boundary)', () => {
    const { parseAllPicksFromSheet } = load();
    const cutoff = SUN.getTime();
    const picks = parseAllPicksFromSheet(fakeSheet(rows()), memberData, cutoff);
    assert.equal(picks.m1.pickem['KC at BUF'], 'BUF');
  });

  it('a cutoff before every submission yields no picks for that member', () => {
    const { parseAllPicksFromSheet } = load();
    const cutoff = THU.getTime() - 1000;
    const picks = parseAllPicksFromSheet(fakeSheet(rows()), memberData, cutoff);
    assert.equal(picks.m1, undefined);
  });

  it('a row with an unparseable timestamp is KEPT, never dropped', () => {
    const { parseAllPicksFromSheet } = load();
    // Dropping it would blank the member's pick, which the N/A fill would then void.
    const bad = [HEADERS, ['not a date', 'Alice', 'KC']];
    const picks = parseAllPicksFromSheet(fakeSheet(bad), memberData, THU.getTime());
    assert.equal(picks.m1.pickem['KC at BUF'], 'KC');
  });

  it('with no timestamp column at all, the cutoff is inert rather than voiding', () => {
    const { parseAllPicksFromSheet } = load();
    const noTs = [['Submitted', 'Select Your Name', 'KC at BUF'], ['x', 'Alice', 'BUF']];
    const picks = parseAllPicksFromSheet(fakeSheet(noTs), memberData, THU.getTime());
    assert.equal(picks.m1.pickem['KC at BUF'], 'BUF');
  });
});
