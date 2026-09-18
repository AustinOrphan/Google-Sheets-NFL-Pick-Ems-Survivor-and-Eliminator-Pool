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

  it('does not match a header that only contains "timestamp" as a substring', () => {
    const { findTimestampColumn } = load();
    assert.equal(findTimestampColumn(['Not a Timestamp', 'Select Your Name'], null), -1);
  });

  it('does not match "Timestamp Submitted", only an exact "Timestamp" header', () => {
    const { findTimestampColumn } = load();
    assert.equal(findTimestampColumn(['Timestamp Submitted', 'Select Your Name'], null), -1);
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

  it('honors a cutoff when the Timestamp column is not the first column', () => {
    const { parseAllPicksFromSheet } = load();
    const movedHeaders = ['Select Your Name', 'Timestamp', 'KC at BUF'];
    const movedRows = [
      movedHeaders,
      ['Alice', THU, 'KC'],
      ['Alice', SUN, 'BUF'],
    ];
    const cutoff = SUN.getTime() - 1000;
    const picks = parseAllPicksFromSheet(fakeSheet(movedRows), memberData, cutoff);
    assert.equal(picks.m1.pickem['KC at BUF'], 'KC');
  });
});

describe('latePolicyPasses', () => {
  // Production shape: gamePlan stores `date` as an ISO-8601 STRING (picks.gs:4100-4101),
  // NOT epoch milliseconds. Fixtures use strings so a number-only implementation fails here.
  const THU = Date.UTC(2026, 8, 17, 20, 15);
  const SUN_EARLY = Date.UTC(2026, 8, 20, 17, 0);
  const SUN_LATE = Date.UTC(2026, 8, 20, 20, 25);
  const iso = (ms) => new Date(ms).toISOString();
  const AFTER_ALL = SUN_LATE + 60 * 60 * 1000;
  const BEFORE_ALL = THU - 60 * 60 * 1000;

  const gamePlan = {
    games: [
      { date: iso(SUN_EARLY), awayTeam: 'KC', homeTeam: 'BUF' },
      { date: iso(THU),       awayTeam: 'NE', homeTeam: 'NYJ' },
      { date: iso(SUN_EARLY), awayTeam: 'SF', homeTeam: 'SEA' },
      { date: iso(SUN_LATE),  awayTeam: 'DAL', homeTeam: 'PHI' },
    ],
  };

  it('kickoffMs parses the ISO string gamePlan actually stores', () => {
    const { kickoffMs } = load();
    assert.equal(kickoffMs({ date: iso(THU) }), THU);
  });

  it('kickoffMs also accepts a Date and a number, and rejects junk', () => {
    const { kickoffMs } = load();
    assert.equal(kickoffMs({ date: new Date(THU) }), THU);
    assert.equal(kickoffMs({ date: iso(THU) }), THU);
    assert.ok(!isFinite(kickoffMs({ date: 'kickoff time' })));
    assert.ok(!isFinite(kickoffMs({ date: null })));
    assert.ok(!isFinite(kickoffMs({})));
    assert.ok(!isFinite(kickoffMs(undefined)));
  });

  it('distinctKickoffs de-duplicates and sorts ascending', () => {
    const { distinctKickoffs } = load();
    assert.deepEqual(distinctKickoffs(gamePlan), [THU, SUN_EARLY, SUN_LATE]);
  });

  it('distinctKickoffs ignores games with an unusable date', () => {
    const { distinctKickoffs } = load();
    const bad = { games: [{ date: iso(THU) }, { date: null }, { date: 'soon' }, {}] };
    assert.deepEqual(distinctKickoffs(bad), [THU]);
  });

  it('distinctKickoffs returns an empty array for a missing gamePlan', () => {
    const { distinctKickoffs } = load();
    assert.deepEqual(distinctKickoffs(undefined), []);
    assert.deepEqual(distinctKickoffs({}), []);
  });

  it('gamesStartingAt returns every game at that exact kickoff', () => {
    const { gamesStartingAt } = load();
    const games = gamesStartingAt(gamePlan, SUN_EARLY);
    assert.equal(games.length, 2);
    assert.deepEqual(games.map(g => g.awayTeam).sort(), ['KC', 'SF']);
  });

  it('gamesAfter returns only games still to come', () => {
    const { gamesAfter } = load();
    assert.deepEqual(gamesAfter(gamePlan, SUN_EARLY).map(g => g.awayTeam), ['DAL']);
    assert.equal(gamesAfter(gamePlan, AFTER_ALL).length, 0);
    assert.equal(gamesAfter(gamePlan, BEFORE_ALL).length, 4);
  });

  it('none is a single overwriting pass with no cutoff', () => {
    const { latePolicyPasses } = load();
    assert.deepEqual(latePolicyPasses('none', gamePlan, AFTER_ALL),
      [{ asOf: null, games: null, fill: 'overwrite' }]);
  });

  it('close is a single pass cut at first kickoff', () => {
    const { latePolicyPasses } = load();
    assert.deepEqual(latePolicyPasses('close', gamePlan, AFTER_ALL),
      [{ asOf: THU, games: null, fill: 'overwrite' }]);
  });

  it('freeze locks everyone at first kickoff, then blank-fills to now', () => {
    const { latePolicyPasses } = load();
    assert.deepEqual(latePolicyPasses('freeze', gamePlan, AFTER_ALL), [
      { asOf: THU, games: null, fill: 'overwrite' },
      { asOf: AFTER_ALL, games: null, fill: 'blanks' },
    ]);
  });

  it('game, after every kickoff, is one blank-filling pass per kickoff, ascending', () => {
    const { latePolicyPasses } = load();
    const passes = latePolicyPasses('game', gamePlan, AFTER_ALL);
    assert.equal(passes.length, 3);
    assert.deepEqual(passes.map(p => p.asOf), [THU, SUN_EARLY, SUN_LATE]);
    assert.ok(passes.every(p => p.fill === 'blanks'));
    assert.deepEqual(passes[1].games.map(g => g.awayTeam).sort(), ['KC', 'SF']);
  });

  it('game NEVER locks a game that has not kicked off yet', () => {
    const { latePolicyPasses } = load();
    // Importing on Friday must not freeze Sunday's picks: a member changing a pick on
    // Saturday would otherwise find Friday's value stuck in the grid.
    const friday = THU + 12 * 60 * 60 * 1000;
    const passes = latePolicyPasses('game', gamePlan, friday);
    const locking = passes.filter(p => p.fill === 'blanks');
    assert.deepEqual(locking.map(p => p.asOf), [THU]);
  });

  it('game previews not-yet-started games with an overwriting pass', () => {
    const { latePolicyPasses } = load();
    const friday = THU + 12 * 60 * 60 * 1000;
    const passes = latePolicyPasses('game', gamePlan, friday);
    const preview = passes.filter(p => p.fill === 'overwrite');
    assert.equal(preview.length, 1);
    assert.equal(preview[0].asOf, null);
    assert.deepEqual(preview[0].games.map(g => g.awayTeam).sort(), ['DAL', 'KC', 'SF']);
  });

  it('game before any kickoff locks nothing at all', () => {
    const { latePolicyPasses } = load();
    const passes = latePolicyPasses('game', gamePlan, BEFORE_ALL);
    assert.ok(passes.every(p => p.fill === 'overwrite'));
    assert.equal(passes.length, 1);
    assert.equal(passes[0].games.length, 4);
  });

  it('an unknown policy behaves exactly as none', () => {
    const { latePolicyPasses } = load();
    assert.deepEqual(latePolicyPasses('nonsense', gamePlan, AFTER_ALL),
      latePolicyPasses('none', gamePlan, AFTER_ALL));
  });

  it('a week with no usable kickoffs is inert for every policy', () => {
    const { latePolicyPasses, LATE_POLICIES } = load();
    const expected = [{ asOf: null, games: null, fill: 'overwrite' }];
    LATE_POLICIES.forEach(p => {
      assert.deepEqual(latePolicyPasses(p, { games: [] }, AFTER_ALL), expected);
      assert.deepEqual(latePolicyPasses(p, undefined, AFTER_ALL), expected);
    });
  });
});

describe('tiebreakerCutoff', () => {
  const THU = Date.UTC(2026, 8, 17, 20, 15);
  const SUN = Date.UTC(2026, 8, 20, 17, 0);
  const MON = Date.UTC(2026, 8, 21, 20, 15);
  const iso = (ms) => new Date(ms).toISOString();

  it('none has no cutoff, so the tiebreaker behaves as it does today', () => {
    const { tiebreakerCutoff } = load();
    const plan = { games: [{ date: iso(THU) }, { date: iso(MON), tiebreaker: true }] };
    assert.equal(tiebreakerCutoff('none', plan), null);
  });

  it('uses the kickoff of the game actually flagged as the tiebreaker', () => {
    const { tiebreakerCutoff } = load();
    // The flagged game is NOT last: picks.gs:4942 exists precisely for that case.
    const plan = { games: [{ date: iso(THU) }, { date: iso(SUN), tiebreaker: true }, { date: iso(MON) }] };
    assert.equal(tiebreakerCutoff('game', plan), SUN);
  });

  it('falls back to the last game when no game is flagged', () => {
    const { tiebreakerCutoff } = load();
    const plan = { games: [{ date: iso(THU) }, { date: iso(MON) }] };
    assert.equal(tiebreakerCutoff('game', plan), MON);
  });

  it('returns null rather than guessing when the plan is missing or dateless', () => {
    const { tiebreakerCutoff } = load();
    assert.equal(tiebreakerCutoff('game', undefined), null);
    assert.equal(tiebreakerCutoff('game', { games: [] }), null);
    assert.equal(tiebreakerCutoff('game', { games: [{ date: 'soon' }] }), null);
  });
});
