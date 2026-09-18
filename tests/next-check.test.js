'use strict';

const { describe, it, assert } = require('./run');
const { load } = require('./harness');

const HOUR = 60 * 60 * 1000;

// A fixed "now": Sunday 2026-09-20 11:00am ET = 15:00 UTC.
const NOW = new Date(Date.UTC(2026, 8, 20, 15, 0, 0));
const at = (hoursFromNow) => NOW.getTime() + hoursFromNow * HOUR;

describe('computeNextCheckTime', () => {
  it('a single upcoming game returns kickoff + GAME_FLOOR', () => {
    const { computeNextCheckTime, OUTCOME_FETCH_GAME_FLOOR_MS } = load();
    const games = [{ kickoff: at(2), status: 'pregame' }];
    const next = computeNextCheckTime(games, NOW);
    assert.equal(next.getTime(), at(2) + OUTCOME_FETCH_GAME_FLOOR_MS);
  });

  it('an in-progress game past its floor clamps to now + 15 minutes', () => {
    const { computeNextCheckTime, OUTCOME_FETCH_CLAMP_MS } = load();
    const games = [{ kickoff: at(-4), status: 'active' }];
    const next = computeNextCheckTime(games, NOW);
    assert.equal(next.getTime(), NOW.getTime() + OUTCOME_FETCH_CLAMP_MS);
  });

  it('overlapping slates return the earlier candidate, not the earlier kickoff', () => {
    const { computeNextCheckTime, OUTCOME_FETCH_GAME_FLOOR_MS, OUTCOME_FETCH_CLAMP_MS } = load();
    // 1pm slate kicked off 2h ago (candidate = 45m from now); 4:25 slate is 5h25m out.
    const games = [
      { kickoff: at(-2), status: 'active' },
      { kickoff: at(5.42), status: 'pregame' },
    ];
    const next = computeNextCheckTime(games, NOW);
    const expected = at(-2) + OUTCOME_FETCH_GAME_FLOOR_MS;
    assert.equal(next.getTime(), expected);
    assert.ok(next.getTime() > NOW.getTime() + OUTCOME_FETCH_CLAMP_MS, 'must not clamp when candidate is comfortably ahead');
  });

  it('a completed game is excluded even when its kickoff is earliest', () => {
    const { computeNextCheckTime, OUTCOME_FETCH_GAME_FLOOR_MS } = load();
    const games = [
      { kickoff: at(1), status: 'complete' },
      { kickoff: at(3), status: 'pregame' },
    ];
    const next = computeNextCheckTime(games, NOW);
    assert.equal(next.getTime(), at(3) + OUTCOME_FETCH_GAME_FLOOR_MS);
  });

  it('all games complete returns null (stand down)', () => {
    const { computeNextCheckTime } = load();
    const games = [
      { kickoff: at(-30), status: 'complete' },
      { kickoff: at(-27), status: 'complete' },
    ];
    assert.equal(computeNextCheckTime(games, NOW), null);
  });

  it('an empty list returns null rather than throwing', () => {
    const { computeNextCheckTime } = load();
    assert.equal(computeNextCheckTime([], NOW), null);
  });

  it('a malformed entry is skipped, not fatal', () => {
    const { computeNextCheckTime, OUTCOME_FETCH_GAME_FLOOR_MS } = load();
    const games = [
      { kickoff: 'not a number', status: 'pregame' },
      { status: 'active' },
      null,
      { kickoff: at(1), status: 'pregame' },
    ];
    const next = computeNextCheckTime(games, NOW);
    assert.equal(next.getTime(), at(1) + OUTCOME_FETCH_GAME_FLOOR_MS);
  });

  it('a candidate exactly at now still clamps forward', () => {
    const { computeNextCheckTime, OUTCOME_FETCH_GAME_FLOOR_MS, OUTCOME_FETCH_CLAMP_MS } = load();
    const kickoff = NOW.getTime() - OUTCOME_FETCH_GAME_FLOOR_MS; // candidate == now
    const next = computeNextCheckTime([{ kickoff, status: 'active' }], NOW);
    assert.equal(next.getTime(), NOW.getTime() + OUTCOME_FETCH_CLAMP_MS);
  });

  it('does not read the wall clock: same inputs, same output, regardless of real time', () => {
    const { computeNextCheckTime } = load();
    const games = [{ kickoff: at(2), status: 'pregame' }];
    const a = computeNextCheckTime(games, NOW).getTime();
    const b = computeNextCheckTime(games, NOW).getTime();
    assert.equal(a, b);
  });
});
