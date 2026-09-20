'use strict';

const { describe, it, assert } = require('./run');
const { load } = require('./harness');

/**
 * Pacing the multi-week rebuild.
 *
 * Menu-invoked functions get the 6-minute script runtime. A rebuild killed part
 * way through leaves a half-rewritten sheet, which is worse than one not yet
 * rebuilt - so the decision is made BEFORE starting a week, never during.
 */

const MIN = 60 * 1000;

describe('timeForAnotherWeek', () => {
  it('says yes with room to spare', () => {
    const { timeForAnotherWeek } = load();
    assert.equal(timeForAnotherWeek(1 * MIN, 20 * 1000, 4.5 * MIN), true);
  });

  it('says no when the next week would run past the budget', () => {
    const { timeForAnotherWeek } = load();
    assert.equal(timeForAnotherWeek(4 * MIN, 45 * 1000, 4.5 * MIN), false);
  });

  it('allows a week that lands exactly on the budget', () => {
    const { timeForAnotherWeek } = load();
    assert.equal(timeForAnotherWeek(4 * MIN, 30 * 1000, 4.5 * MIN), true);
  });

  it('gets more cautious as weeks get slower', () => {
    // The estimate is the slowest week seen so far, so a heavy pool stops
    // earlier than a light one at the same elapsed time.
    const { timeForAnotherWeek } = load();
    const elapsed = 3.5 * MIN;
    assert.equal(timeForAnotherWeek(elapsed, 10 * 1000, 4.5 * MIN), true);
    assert.equal(timeForAnotherWeek(elapsed, 90 * 1000, 4.5 * MIN), false);
  });

  it('leaves real headroom under the 6-minute limit', () => {
    const { REBUILD_BUDGET_MS } = load();
    assert.ok(REBUILD_BUDGET_MS < 6 * MIN, 'budget must sit under the script limit');
    assert.ok(6 * MIN - REBUILD_BUDGET_MS >= 60 * 1000, 'leave at least a minute of slack');
  });
});

describe('the pacing loop, simulated', () => {
  /** Mirror of the loop in rebuildWeeklySheet, to check where it stops. */
  const run = (weeks, perWeekMs, budgetMs) => {
    const { timeForAnotherWeek } = load();
    let elapsed = 0;
    let slowest = 0;
    const done = [];
    for (const week of weeks) {
      if (done.length > 0 && !timeForAnotherWeek(elapsed, slowest, budgetMs)) break;
      const took = perWeekMs[weeks.indexOf(week)];
      elapsed += took;
      slowest = Math.max(slowest, took);
      done.push(week);
    }
    return { done, left: weeks.filter((w) => !done.includes(w)) };
  };

  it('finishes a short list well inside the budget', () => {
    const r = run([1, 2, 3], [10000, 10000, 10000], 4.5 * MIN);
    assert.deepEqual(r.done, [1, 2, 3]);
    assert.deepEqual(r.left, []);
  });

  it('stops partway through a long list and names what is left', () => {
    const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
    const r = run(weeks, weeks.map(() => 20000), 4.5 * MIN);
    assert.ok(r.done.length < 18, 'should not attempt all 18 at 20s each');
    assert.ok(r.left.length > 0, 'the remainder must be reported');
    assert.deepEqual([...r.done, ...r.left], weeks, 'every week is accounted for');
  });

  it('always attempts at least one week, however slow', () => {
    // Otherwise a pool where one rebuild exceeds the whole budget could never
    // rebuild anything at all.
    const r = run([1, 2], [10 * MIN, 10 * MIN], 4.5 * MIN);
    assert.deepEqual(r.done, [1]);
    assert.deepEqual(r.left, [2]);
  });
});
