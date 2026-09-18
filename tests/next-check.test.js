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

describe('collectOutstandingGames', () => {
  const g = (date, extra) => Object.assign({ date, shortName: 'A @ B', homeScore: 0, awayScore: 0, winner: null }, extra);

  it('flattens every status bucket of the current week with the bucket name as status', () => {
    const { collectOutstandingGames } = load();
    const analysis = {
      '3': { pregame: [g(100)], active: [g(200)], postponed: [g(300)], complete: [g(400)], unknown: [g(500)] },
    };
    const out = collectOutstandingGames(analysis, 3);
    const byKick = Object.fromEntries(out.map(x => [x.kickoff, x.status]));
    assert.deepEqual(byKick, { 100: 'pregame', 200: 'active', 300: 'postponed', 400: 'complete', 500: 'unknown' });
  });

  it('includes the following week so rollover needs no special rule', () => {
    const { collectOutstandingGames } = load();
    const analysis = {
      '3': { pregame: [], active: [], postponed: [], complete: [g(100)], unknown: [] },
      '4': { pregame: [g(900)], active: [], postponed: [], complete: [], unknown: [] },
    };
    const out = collectOutstandingGames(analysis, 3);
    assert.ok(out.some(x => x.kickoff === 900 && x.status === 'pregame'));
  });

  it('does not look past the regular season', () => {
    const { collectOutstandingGames, REGULAR_SEASON } = load();
    const analysis = {};
    analysis[String(REGULAR_SEASON)] = { pregame: [], active: [], postponed: [], complete: [g(100)], unknown: [] };
    analysis[String(REGULAR_SEASON + 1)] = { pregame: [g(900)], active: [], postponed: [], complete: [], unknown: [] };
    const out = collectOutstandingGames(analysis, REGULAR_SEASON);
    assert.equal(out.length, 1);
    assert.equal(out[0].kickoff, 100);
  });

  it('tolerates a missing week and a missing bucket', () => {
    const { collectOutstandingGames } = load();
    const analysis = { '3': { active: [g(200)] } };
    const out = collectOutstandingGames(analysis, 3);
    assert.deepEqual(out, [{ kickoff: 200, status: 'active' }]);
  });

  it('returns an empty array for a null analysis', () => {
    const { collectOutstandingGames } = load();
    assert.deepEqual(collectOutstandingGames(null, 3), []);
  });
});

describe('isOutcomeImportProblem', () => {
  it('is true for the importer\'s problem message', () => {
    const { isOutcomeImportProblem } = load();
    assert.equal(isOutcomeImportProblem({ message: '⚠️ Outcome Import Issue: nope' }), true);
  });

  it('is false for a success message', () => {
    const { isOutcomeImportProblem } = load();
    assert.equal(isOutcomeImportProblem({ message: '✅ SUCCESS!\n\nImported outcomes' }), false);
  });

  it('is false for false, null, undefined, and a message that is not a string', () => {
    const { isOutcomeImportProblem } = load();
    assert.equal(isOutcomeImportProblem(false), false);
    assert.equal(isOutcomeImportProblem(null), false);
    assert.equal(isOutcomeImportProblem(undefined), false);
    assert.equal(isOutcomeImportProblem({ message: 42 }), false);
  });
});
