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
