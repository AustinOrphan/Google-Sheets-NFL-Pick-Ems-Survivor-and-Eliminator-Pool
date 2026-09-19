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

  it('a cutoff of 0 is a real cutoff, not "no cutoff"', () => {
    const { parseAllPicksFromSheet } = load();
    // 0 is epoch (1970) and falsy. Guarding with `if (asOf)` would silently treat a
    // programmatically computed 0 as "no cutoff" and import everything. Task 6 derives
    // cutoffs from kickoffMs, so a bad subtraction must fail loudly, not disable the policy.
    const picks = parseAllPicksFromSheet(fakeSheet(rows()), memberData, 0);
    assert.equal(picks.m1, undefined);
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
    // An actual number, not the ISO string again: Date.parse of a numeric epoch is NaN,
    // so deleting the numeric branch of kickoffMs has to fail here.
    assert.equal(kickoffMs({ date: THU }), THU);
    assert.ok(!isFinite(kickoffMs({ date: Infinity })));
    assert.ok(!isFinite(kickoffMs({ date: NaN })));
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

  it('game, after every kickoff, is one locking pass per kickoff, ascending', () => {
    const { latePolicyPasses } = load();
    const passes = latePolicyPasses('game', gamePlan, AFTER_ALL);
    assert.equal(passes.length, 3);
    assert.deepEqual(passes.map(p => p.asOf), [THU, SUN_EARLY, SUN_LATE]);
    // 'lock', not 'blanks': every one of these cutoffs is a fixed instant in the past, so
    // re-asserting the answer is idempotent. 'blanks' would skip the cell an earlier
    // import's preview pass had already filled and lose the as-of-kickoff answer.
    assert.ok(passes.every(p => p.fill === 'lock'));
    assert.deepEqual(passes[1].games.map(g => g.awayTeam).sort(), ['KC', 'SF']);
  });

  it('game NEVER locks a game that has not kicked off yet', () => {
    const { latePolicyPasses } = load();
    // Importing on Friday must not freeze Sunday's picks: a member changing a pick on
    // Saturday would otherwise find Friday's value stuck in the grid.
    const friday = THU + 12 * 60 * 60 * 1000;
    const passes = latePolicyPasses('game', gamePlan, friday);
    const locking = passes.filter(p => p.fill === 'lock');
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

  // A schedule cell that is blank or holds text leaves `date` as '' (analyzeScheduleData
  // only converts a real Date), so a usable week can still contain a dateless game.
  const mixedPlan = {
    games: [
      { date: iso(THU),      awayTeam: 'NE', homeTeam: 'NYJ' },
      { date: '',            awayTeam: 'KC', homeTeam: 'BUF' },
      { date: iso(SUN_LATE), awayTeam: 'SF', homeTeam: 'SEA' },
    ],
  };
  const passesHolding = (passes, away, allGames) =>
    passes.filter(p => (p.games === null ? allGames : p.games).some(g => g.awayTeam === away));

  it('game writes a dateless game in an overwriting pass rather than dropping it', () => {
    const { latePolicyPasses } = load();
    // Falling out of every pass would leave those cells untouched forever: no value, no
    // N/A, no error. A dateless game has no kickoff, so it can never be locked either.
    const passes = latePolicyPasses('game', mixedPlan, AFTER_ALL);
    const holding = passesHolding(passes, 'KC', mixedPlan.games);
    assert.equal(holding.length, 1);
    assert.equal(holding[0].fill, 'overwrite');
    assert.equal(holding[0].asOf, null);
  });

  it('game covers every game exactly once even when one of them is dateless', () => {
    const { latePolicyPasses } = load();
    const midweek = THU + 12 * 60 * 60 * 1000;
    [BEFORE_ALL, midweek, AFTER_ALL].forEach(now => {
      const passes = latePolicyPasses('game', mixedPlan, now);
      mixedPlan.games.forEach(game => {
        const holding = passesHolding(passes, game.awayTeam, mixedPlan.games);
        assert.equal(holding.length, 1, `${game.awayTeam} must be in exactly one pass at ${now}`);
      });
      const kc = passesHolding(passes, 'KC', mixedPlan.games)[0];
      assert.equal(kc.fill, 'overwrite', 'a dateless game is never locked');
    });
  });

  it('close and freeze already cover a dateless game, because they write every game', () => {
    const { latePolicyPasses } = load();
    ['close', 'freeze'].forEach(policy => {
      const passes = latePolicyPasses(policy, mixedPlan, AFTER_ALL);
      assert.ok(passes.every(p => p.games === null), `${policy} writes all games`);
    });
  });

  it('a week where every game is dateless still reduces to the single open pass', () => {
    const { latePolicyPasses, LATE_POLICIES } = load();
    const dateless = {
      games: [
        { date: '', awayTeam: 'KC', homeTeam: 'BUF' },
        { date: 'soon', awayTeam: 'SF', homeTeam: 'SEA' },
      ],
    };
    LATE_POLICIES.forEach(p => {
      assert.deepEqual(latePolicyPasses(p, dateless, AFTER_ALL),
        [{ asOf: null, games: null, fill: 'overwrite' }]);
    });
  });

  it('a game kicking off at exactly now is in exactly one pass, the locking one', () => {
    const { latePolicyPasses } = load();
    // Pins the `kickoff <= now` / `kickoff > now` pairing: `<` would drop these games from
    // every pass, `>=` in gamesAfter would put them in two.
    const passes = latePolicyPasses('game', gamePlan, SUN_EARLY);
    gamePlan.games.forEach(game => {
      const holding = passesHolding(passes, game.awayTeam, gamePlan.games);
      assert.equal(holding.length, 1, `${game.awayTeam} must be in exactly one pass`);
    });
    const kc = passesHolding(passes, 'KC', gamePlan.games)[0];
    assert.equal(kc.fill, 'lock');
    assert.equal(kc.asOf, SUN_EARLY);
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

  it('logs when a requested policy degrades to no policy, but never for none', () => {
    const { latePolicyPasses } = load();
    // A policy that silently becomes none is exactly the symptom of a wrong date shape,
    // so it has to be visible. none is the default and would spam every single import.
    const original = globalThis.Logger;
    const logged = [];
    globalThis.Logger = { log: (message) => logged.push(String(message)) };
    try {
      latePolicyPasses('none', { games: [] }, AFTER_ALL);
      assert.equal(logged.length, 0, 'none must not log');
      latePolicyPasses('close', { games: [] }, AFTER_ALL);
      latePolicyPasses('game', { games: [{ date: '' }] }, AFTER_ALL);
      assert.equal(logged.length, 2);
      assert.ok(logged.every(m => m.includes('⚠️')));
      assert.ok(logged[0].includes('close'));
      assert.ok(logged[1].includes('game'));
      logged.length = 0;
      latePolicyPasses('close', gamePlan, AFTER_ALL);
      assert.equal(logged.length, 0, 'an applicable policy must not log');
    } finally {
      globalThis.Logger = original;
    }
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

  it('close cuts the tiebreaker at first kickoff, not at the tiebreaker game', () => {
    const { tiebreakerCutoff } = load();
    // close discards everything submitted after first kickoff, so a submission whose
    // pick'em answers were thrown away on Thursday cannot still score a tiebreaker Monday.
    const plan = { games: [{ date: iso(THU) }, { date: iso(SUN) }, { date: iso(MON), tiebreaker: true }] };
    assert.equal(tiebreakerCutoff('close', plan), THU);
  });

  it('close uses first kickoff even when the tiebreaker game is the earliest one', () => {
    const { tiebreakerCutoff } = load();
    const plan = { games: [{ date: iso(SUN) }, { date: iso(THU), tiebreaker: true }, { date: iso(MON) }] };
    assert.equal(tiebreakerCutoff('close', plan), THU);
  });

  it('freeze lets the tiebreaker follow its own game, which it keeps blank-filling to', () => {
    const { tiebreakerCutoff } = load();
    const plan = { games: [{ date: iso(THU) }, { date: iso(MON), tiebreaker: true }] };
    assert.equal(tiebreakerCutoff('freeze', plan), MON);
  });

  it('game lets the tiebreaker follow its own game', () => {
    const { tiebreakerCutoff } = load();
    const plan = { games: [{ date: iso(THU) }, { date: iso(MON), tiebreaker: true }] };
    assert.equal(tiebreakerCutoff('game', plan), MON);
  });

  it('no policy ever puts the tiebreaker cutoff past its own game kickoff', () => {
    const { tiebreakerCutoff, LATE_POLICIES } = load();
    const plan = { games: [{ date: iso(THU) }, { date: iso(SUN), tiebreaker: true }, { date: iso(MON) }] };
    LATE_POLICIES.forEach(p => {
      const cutoff = tiebreakerCutoff(p, plan);
      if (cutoff !== null) assert.ok(cutoff <= SUN, `${p} must not outrun the tiebreaker kickoff`);
    });
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

describe('latePickCellAction', () => {
  it('overwrite mode writes a pick over an existing value (today\'s behavior)', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('KC', false, 'BUF', 'overwrite'), 'write');
  });

  it('overwrite mode never writes N/A', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('', true, null, 'overwrite'), 'skip');
  });

  it('blanks mode leaves a filled cell alone, which is what locks a pick', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('KC', true, 'BUF', 'blanks'), 'skip');
  });

  it('blanks mode writes a pick into an empty cell', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('', true, 'BUF', 'blanks'), 'write');
  });

  it('blanks mode writes N/A for a started game with no pick', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('', true, null, 'blanks'), 'na');
  });

  it('blanks mode leaves an UNSTARTED game blank rather than voiding it', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('', false, null, 'blanks'), 'skip');
  });

  it('treats null and undefined cells as empty, like the empty string', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction(null, true, null, 'blanks'), 'na');
    assert.equal(latePickCellAction(undefined, true, 'BUF', 'blanks'), 'write');
  });

  it('a cell already holding N/A is filled, so it is never rewritten', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('N/A', true, 'BUF', 'blanks'), 'skip');
  });
});

describe('latePickCellAction lock fill', () => {
  it('lock writes the pick over an existing value, so re-importing is idempotent', () => {
    const { latePickCellAction } = load();
    // The value already there is an earlier import's preview of what was then an unstarted
    // game. 'blanks' would skip it and the as-of-kickoff answer would never land.
    assert.equal(latePickCellAction('KC', true, 'BUF', 'lock'), 'write');
  });

  it('lock writes the pick into an empty cell', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('', true, 'BUF', 'lock'), 'write');
  });

  it('lock voids a started game the member never answered', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('', true, null, 'lock'), 'na');
  });

  it('lock re-voids a cell already holding N/A instead of reading it as filled', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('N/A', true, null, 'lock'), 'na');
  });

  it('lock leaves an UNSTARTED game alone rather than voiding it', () => {
    const { latePickCellAction } = load();
    assert.equal(latePickCellAction('', false, null, 'lock'), 'skip');
    assert.equal(latePickCellAction('KC', false, null, 'lock'), 'skip');
  });

  it('lock overwrites a manual operator edit to a started game (accepted, and pinned)', () => {
    const { latePickCellAction } = load();
    // Under 'game' the next import re-asserts the answer as of that kickoff, so a hand edit
    // does not survive. That is deliberate. A cell that can drift between imports is exactly
    // the schedule dependence the 'lock' fill exists to remove, so do not "fix" this by
    // making lock skip a filled cell: that is the bug it replaced.
    assert.equal(latePickCellAction('NYJ', true, 'BUF', 'lock'), 'write');
    assert.equal(latePickCellAction('NYJ', true, null, 'lock'), 'na');
  });

  it('freeze still fills blanks only, because its second cutoff moves with the clock', () => {
    const { latePolicyPasses } = load();
    const THU = Date.UTC(2026, 8, 17, 20, 15);
    const plan = { games: [{ date: new Date(THU).toISOString(), awayTeam: 'NE', homeTeam: 'NYJ' }] };
    const passes = latePolicyPasses('freeze', plan, THU + 1000);
    // asOf 'now' means the answer this pass computes keeps changing, so re-writing it would
    // let a member edit a pick that was supposed to be frozen. Only 'blanks' is safe there.
    assert.equal(passes[passes.length - 1].fill, 'blanks');
  });
});

describe('none reproduces today\'s behavior exactly', () => {
  it('latePolicyPasses(none) is the single open pass whatever the week looks like', () => {
    const { latePolicyPasses } = load();
    const open = [{ asOf: null, games: null, fill: 'overwrite' }];
    const plan = {
      games: [
        { date: '2026-09-17T20:15:00.000Z', awayTeam: 'NE', homeTeam: 'NYJ' },
        { date: '', awayTeam: 'KC', homeTeam: 'BUF' },
      ],
    };
    [0, Date.UTC(2026, 8, 17), Date.UTC(2030, 0, 1)].forEach(now => {
      assert.deepEqual(latePolicyPasses('none', plan, now), open);
      assert.deepEqual(latePolicyPasses(undefined, plan, now), open);
    });
  });

  it('an overwrite pass never voids, for any cell value or scoreboard state', () => {
    const { latePickCellAction } = load();
    ['', null, undefined, 'KC', 'N/A', 0].forEach(cell => {
      [true, false].forEach(started => {
        assert.equal(latePickCellAction(cell, started, null, 'overwrite'), 'skip');
        assert.equal(latePickCellAction(cell, started, 'BUF', 'overwrite'), 'write');
      });
    });
  });
});

describe('pickForGame', () => {
  const game = {
    awayTeam: 'KC', homeTeam: 'BUF',
    awayTeamName: 'Kansas City Chiefs', homeTeamName: 'Buffalo Bills',
  };
  const asked = ['Kansas City Chiefs at Buffalo Bills', 'Dallas Cowboys at Philadelphia Eagles'];

  it('returns the answer when a question matched and it names one of the two teams', () => {
    const { pickForGame } = load();
    const picks = { questions: asked, pickem: { 'Kansas City Chiefs at Buffalo Bills': 'BUF' } };
    assert.deepEqual(pickForGame(picks, game), { matched: true, pick: 'BUF' });
  });

  it('matched with no pick when the member was asked and left it blank', () => {
    const { pickForGame } = load();
    // parseAllPicksFromSheet stores nothing at all for a blank answer, so `questions` is
    // the only evidence the member ever saw this matchup. N/A is correct for them.
    const picks = { questions: asked, pickem: { 'Dallas Cowboys at Philadelphia Eagles': 'DAL' } };
    assert.deepEqual(pickForGame(picks, game), { matched: true, pick: null });
  });

  it('NOT matched when no question on the form was about this matchup at all', () => {
    const { pickForGame } = load();
    // This is the case that must never become N/A: the member was never asked.
    const picks = {
      questions: ['Dallas Cowboys at Philadelphia Eagles'],
      pickem: { 'Dallas Cowboys at Philadelphia Eagles': 'DAL' },
    };
    assert.deepEqual(pickForGame(picks, game), { matched: false, pick: null });
  });

  it('matched with no pick when the answer names neither team', () => {
    const { pickForGame } = load();
    const picks = { questions: asked, pickem: { 'Kansas City Chiefs at Buffalo Bills': 'MIA' } };
    assert.deepEqual(pickForGame(picks, game), { matched: true, pick: null });
  });

  it('falls back to the answered questions when `questions` is absent', () => {
    const { pickForGame } = load();
    const picks = { pickem: { 'Kansas City Chiefs at Buffalo Bills': 'KC' } };
    assert.deepEqual(pickForGame(picks, game), { matched: true, pick: 'KC' });
  });

  it('no submission at all is not a match, which is what keeps N/A working', () => {
    const { pickForGame } = load();
    assert.deepEqual(pickForGame(null, game), { matched: false, pick: null });
    assert.deepEqual(pickForGame(undefined, game), { matched: false, pick: null });
  });

  it('a game missing its full team names matches nothing, rather than matching everything', () => {
    const { pickForGame } = load();
    // A bare truthiness check would match every question here; String.includes(undefined)
    // would hunt for the literal text "undefined". Both are wrong, and silently so.
    const picks = { questions: asked, pickem: { 'Kansas City Chiefs at Buffalo Bills': 'BUF' } };
    assert.deepEqual(pickForGame(picks, { awayTeam: 'KC', homeTeam: 'BUF' }), { matched: false, pick: null });
  });
});

describe('parseAllPicksFromSheet records the questions the form asked', () => {
  const HEADERS = [
    'Timestamp', 'Select Your Name',
    'Kansas City Chiefs at Buffalo Bills',
    'Dallas Cowboys at Philadelphia Eagles',
    'Survivor Pick', 'Eliminator Pick',
    'Tiebreaker: total points', 'Any comments?',
  ];
  const memberData = { members: { m1: { name: 'Alice' } }, memberOrder: ['m1'] };
  const fakeSheet = (rows) => ({
    getName: () => 'WK1',
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  });

  it('lists a matchup question the member left blank, which pickem alone cannot show', () => {
    const { parseAllPicksFromSheet } = load();
    const rows = [HEADERS, [new Date(Date.UTC(2026, 8, 16)), 'Alice', 'BUF', '', 'KC', 'NYJ', '44', 'hi']];
    const picks = parseAllPicksFromSheet(fakeSheet(rows), memberData);
    assert.equal(picks.m1.pickem['Dallas Cowboys at Philadelphia Eagles'], undefined);
    assert.deepEqual(picks.m1.questions, [
      'Kansas City Chiefs at Buffalo Bills',
      'Dallas Cowboys at Philadelphia Eagles',
    ]);
  });

  it('leaves the survivor, eliminator, tiebreaker and comments columns out of the list', () => {
    const { parseAllPicksFromSheet } = load();
    const rows = [HEADERS, [new Date(Date.UTC(2026, 8, 16)), 'Alice', 'BUF', 'PHI', 'KC', 'NYJ', '44', 'hi']];
    const picks = parseAllPicksFromSheet(fakeSheet(rows), memberData);
    assert.equal(picks.m1.questions.length, 2);
    assert.ok(picks.m1.questions.every(q => / at /i.test(q)));
  });
});

/**
 * A stand-in for the grid loop of executePickImport.
 *
 * executePickImport itself needs SpreadsheetApp, named ranges and live scoreboard state, so
 * it cannot run in this harness. This mirrors its pass loop and nothing else: the policy
 * passes, the response parse, the question match and the per-cell decision are all the real
 * functions out of picks.gs. Only the sheet plumbing is stood in for, and a game counts as
 * started once its kickoff has passed.
 *
 * `fixture.submissions` rows are ordered [Date, name, ...answers] and are filtered by the
 * simulated clock, so an import can only ever see what had actually been submitted by then.
 * That detail is the whole point: a fixture that hands every row to every import cannot see
 * the bug these tests exist to pin.
 */
function makeImportSimulator(fixture) {
  const { gamePlan, headers, submissions, memberData, policy } = fixture;
  const games = gamePlan.games;

  const sheetAsOf = (now) => ({
    getName: () => 'WK1',
    getDataRange: () => ({
      getValues: () => [headers.slice()].concat(
        submissions.filter(row => row[0].getTime() <= now).map(row => row.slice())),
    }),
  });

  const runImport = (grid, now) => {
    const { latePolicyPasses, parseAllPicksFromSheet, pickForGame, latePickCellAction, kickoffMs } = load();
    const sheet = sheetAsOf(now);
    const noCutoff = parseAllPicksFromSheet(sheet, memberData);
    latePolicyPasses(policy, gamePlan, now).forEach(pass => {
      const passPicks = pass.asOf === null ? noCutoff : parseAllPicksFromSheet(sheet, memberData, pass.asOf);
      const passGames = pass.games === null ? games : pass.games;
      passGames.forEach(game => {
        const colIndex = games.indexOf(game);
        const gameStarted = kickoffMs(game) <= now;
        memberData.memberOrder.forEach((memberId, rowIndex) => {
          const memberPicks = passPicks[memberId] || null;
          const { matched, pick } = pickForGame(memberPicks, game);
          if (memberPicks && !matched) return;   // submitted, but never asked this matchup
          const action = latePickCellAction(grid[rowIndex][colIndex], gameStarted, pick, pass.fill);
          if (action === 'write') grid[rowIndex][colIndex] = pick;
          else if (action === 'na') grid[rowIndex][colIndex] = 'N/A';
        });
      });
    });
    return grid;
  };

  const emptyGrid = () => memberData.memberOrder.map(() => games.map(() => ''));
  return { runImport, emptyGrid };
}

describe('game policy does not depend on when the operator imports', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const WED      = Date.UTC(2026, 8, 16, 18, 0);    // Alice's first submission
  const THU_KICK = Date.UTC(2026, 8, 17, 20, 15);
  const FRI      = Date.UTC(2026, 8, 18, 12, 0);
  const SAT      = Date.UTC(2026, 8, 19, 18, 0);    // Alice's legal pick change
  const SUN_KICK = Date.UTC(2026, 8, 20, 17, 0);
  const MON_KICK = Date.UTC(2026, 8, 21, 20, 15);
  const TUE      = Date.UTC(2026, 8, 22, 12, 0);

  const games = [
    { date: iso(THU_KICK), awayTeam: 'NE',  homeTeam: 'NYJ', awayTeamName: 'New England Patriots', homeTeamName: 'New York Jets' },
    { date: iso(SUN_KICK), awayTeam: 'KC',  homeTeam: 'BUF', awayTeamName: 'Kansas City Chiefs',   homeTeamName: 'Buffalo Bills' },
    { date: iso(MON_KICK), awayTeam: 'DAL', homeTeam: 'PHI', awayTeamName: 'Dallas Cowboys',       homeTeamName: 'Philadelphia Eagles' },
  ];
  const gamePlan = { games };

  // Alice picks all three away sides on Wednesday, then legally switches to all three home
  // sides on Saturday, before both the Sunday and the Monday game. Bob never submits at all.
  const fixture = {
    gamePlan,
    policy: 'game',
    headers: ['Timestamp', 'Select Your Name'].concat(games.map(g => `${g.awayTeamName} at ${g.homeTeamName}`)),
    submissions: [
      [new Date(WED), 'Alice', 'NE',  'KC',  'DAL'],
      [new Date(SAT), 'Alice', 'NYJ', 'BUF', 'PHI'],
    ],
    memberData: { members: { m1: { name: 'Alice' }, m2: { name: 'Bob' } }, memberOrder: ['m1', 'm2'] },
  };
  const { runImport, emptyGrid } = makeImportSimulator(fixture);

  // Every way an operator might realistically run the import through one week.
  const SCHEDULES = {
    'once, on Tuesday': [TUE],
    'Wednesday, then Tuesday': [WED + 1000, TUE],
    'after Thursday kickoff, then Tuesday': [THU_KICK + 1000, TUE],
    'at every kickoff': [THU_KICK, SUN_KICK, MON_KICK, TUE],
    'every day of the week': [WED + 1000, THU_KICK + 1000, FRI, SAT + 1000, SUN_KICK, MON_KICK, TUE],
  };
  const gridAfter = (times) => {
    const grid = emptyGrid();
    times.forEach(now => runImport(grid, now));
    return grid;
  };

  it('every import schedule produces the same grid', () => {
    // NE is Wednesday's answer, locked when Thursday kicked off before Alice changed it.
    // BUF and PHI are Saturday's change, made before either of those games kicked off.
    // Before the 'lock' fill this returned NE/KC/DAL, NE/KC/DAL and NE/KC/PHI for the
    // last three schedules: the grid depended on when the operator happened to import.
    Object.keys(SCHEDULES).forEach(name => {
      assert.deepEqual(gridAfter(SCHEDULES[name])[0], ['NE', 'BUF', 'PHI'], `Alice, importing ${name}`);
    });
  });

  it('a member who never submitted is voided once every game has started', () => {
    Object.keys(SCHEDULES).forEach(name => {
      assert.deepEqual(gridAfter(SCHEDULES[name])[1], ['N/A', 'N/A', 'N/A'], `Bob, importing ${name}`);
    });
  });

  it('importing again changes nothing, however many times it runs', () => {
    const grid = emptyGrid();
    runImport(grid, TUE);
    const once = grid.map(row => row.slice());
    runImport(grid, TUE);
    runImport(grid, TUE + 7 * 24 * 60 * 60 * 1000);
    assert.deepEqual(grid, once);
  });

  it('an unstarted game stays changeable right up to its own kickoff', () => {
    // The preview pass has to keep tracking the latest submission, or a member who changes
    // a pick on Saturday after a Friday import would find Friday's value stuck.
    const grid = emptyGrid();
    runImport(grid, FRI);
    assert.deepEqual(grid[0], ['NE', 'KC', 'DAL']);
    runImport(grid, SAT + 1000);
    assert.deepEqual(grid[0], ['NE', 'BUF', 'PHI']);
  });

  it('a manual edit to a started game is overwritten by the next import (accepted, pinned)', () => {
    // Intended, and the direct price of schedule independence: the locking pass re-asserts
    // the answer as of that kickoff every time it runs. Pinned so nobody "fixes" it by
    // making 'lock' skip filled cells, which is precisely the bug it replaced.
    const grid = emptyGrid();
    runImport(grid, TUE);
    grid[0][0] = 'NYJ';    // operator hand-edits one of Alice's locked cells
    grid[1][2] = 'DAL';    // and hand-fills one of Bob's voided cells
    runImport(grid, TUE);
    assert.deepEqual(grid[0], ['NE', 'BUF', 'PHI']);
    assert.deepEqual(grid[1], ['N/A', 'N/A', 'N/A']);
  });

  it('freeze, whose second cutoff moves, is left on the blank-filling rule', () => {
    // freeze deliberately locks everyone at first kickoff and only fills blanks after, so
    // its result is allowed to differ from 'game'. This pins that the fix did not leak.
    const frozen = makeImportSimulator(Object.assign({}, fixture, { policy: 'freeze' }));
    const grid = frozen.emptyGrid();
    frozen.runImport(grid, TUE);
    // Locked at first kickoff, so Saturday's change is discarded outright. That is freeze.
    assert.deepEqual(grid[0], ['NE', 'KC', 'DAL']);
  });
});

describe('a matchup the form never asked about is not voided', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const WED      = Date.UTC(2026, 8, 16, 18, 0);
  const THU_KICK = Date.UTC(2026, 8, 17, 20, 15);
  const SUN_KICK = Date.UTC(2026, 8, 20, 17, 0);
  const MON_KICK = Date.UTC(2026, 8, 21, 20, 15);
  const TUE      = Date.UTC(2026, 8, 22, 12, 0);

  const games = [
    { date: iso(THU_KICK), awayTeam: 'NE',  homeTeam: 'NYJ', awayTeamName: 'New England Patriots', homeTeamName: 'New York Jets' },
    { date: iso(SUN_KICK), awayTeam: 'KC',  homeTeam: 'BUF', awayTeamName: 'Kansas City Chiefs',   homeTeamName: 'Buffalo Bills' },
    // Added to the game plan, or corrected, after the form went out: no question asks it.
    { date: iso(MON_KICK), awayTeam: 'DAL', homeTeam: 'PHI', awayTeamName: 'Dallas Cowboys',       homeTeamName: 'Philadelphia Eagles' },
  ];

  const { runImport, emptyGrid } = makeImportSimulator({
    gamePlan: { games },
    policy: 'game',
    headers: [
      'Timestamp', 'Select Your Name',
      'New England Patriots at New York Jets',
      'Kansas City Chiefs at Buffalo Bills',
    ],
    submissions: [
      [new Date(WED), 'Alice', 'NE', 'KC'],
      [new Date(WED), 'Carol', 'NE', ''],   // asked the second question, left it blank
    ],
    memberData: {
      members: { m1: { name: 'Alice' }, m2: { name: 'Carol' }, m3: { name: 'Bob' } },
      memberOrder: ['m1', 'm2', 'm3'],
    },
  });

  it('leaves the unasked matchup alone for everyone who submitted', () => {
    const grid = emptyGrid();
    runImport(grid, TUE);
    // Alice answered both questions she was given. The third column is not hers to lose:
    // before this fix a locking pass voided it with N/A for a question she never saw.
    assert.deepEqual(grid[0], ['NE', 'KC', '']);
  });

  it('still voids a question that WAS asked and left blank', () => {
    const grid = emptyGrid();
    runImport(grid, TUE);
    assert.deepEqual(grid[1], ['NE', 'N/A', '']);
  });

  it('still voids every game for a member who submitted nothing at all', () => {
    const grid = emptyGrid();
    runImport(grid, TUE);
    // No submission is a real answer of "none", unlike a question that was never asked.
    assert.deepEqual(grid[2], ['N/A', 'N/A', 'N/A']);
  });
});

// ---------------------------------------------------------------------------
// The tiebreaker is written by its own loop in executePickImport, not by the
// grid loop, so it needs its own simulation. This mirrors that loop exactly.
// Found in live testing: under 'freeze' the picks locked at first kickoff but
// the tiebreaker stayed open until the tiebreaker game started, so a member
// frozen out of changing their picks could still change their tiebreaker.
// ---------------------------------------------------------------------------
function makeTiebreakerSimulator(fixture) {
  const { gamePlan, headers, submissions, memberData, policy } = fixture;

  const sheetAsOf = (now) => ({
    getName: () => 'WK1',
    getDataRange: () => ({
      getValues: () => [headers.slice()].concat(
        submissions.filter(row => row[0].getTime() <= now).map(row => row.slice())),
    }),
  });

  const runImport = (cells, now) => {
    const { latePolicyPasses, tiebreakerCutoff, parseAllPicksFromSheet } = load();
    const sheet = sheetAsOf(now);
    const uncut = parseAllPicksFromSheet(sheet, memberData);
    const cache = new Map();
    const picksAsOf = (asOf) => {
      if (asOf === null || asOf === undefined) return uncut;
      if (!cache.has(asOf)) cache.set(asOf, parseAllPicksFromSheet(sheet, memberData, asOf));
      return cache.get(asOf);
    };
    const tbGameKickoff = tiebreakerCutoff(policy, gamePlan);
    latePolicyPasses(policy, gamePlan, now).forEach(pass => {
      const tbAsOf = tbGameKickoff === null
        ? pass.asOf
        : (pass.asOf === null ? tbGameKickoff : Math.min(pass.asOf, tbGameKickoff));
      const tbPicks = picksAsOf(tbAsOf);
      memberData.memberOrder.forEach((memberId, rowIndex) => {
        const tb = tbPicks[memberId];
        if (!tb || !tb.tiebreaker) return;
        const isBlank = cells[rowIndex] === '';
        if (pass.fill === 'blanks' && !isBlank) return;
        cells[rowIndex] = tb.tiebreaker;
      });
    });
    return cells;
  };

  return { runImport, emptyCells: () => memberData.memberOrder.map(() => '') };
}

describe('the tiebreaker locks with the policy, not on its own schedule', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const THU = Date.UTC(2026, 8, 17, 20, 15);
  const SUN = Date.UTC(2026, 8, 20, 17, 0);
  const MON = Date.UTC(2026, 8, 22, 0, 15);
  const WED = THU - 86400000;
  const SUN_PM = SUN + 2 * 3600000;   // after first kickoff, before the tiebreaker game
  const TUE = MON + 86400000;

  const gamePlan = { games: [
    { date: iso(THU), awayTeam: 'NE', homeTeam: 'SEA' },
    { date: iso(SUN), awayTeam: 'KC', homeTeam: 'BUF' },
    { date: iso(MON), awayTeam: 'GB', homeTeam: 'MIN', tiebreaker: true },
  ]};

  // Alice submits on time and then resubmits after first kickoff.
  // Bob never submitted on time and submits once, late.
  const base = {
    gamePlan,
    headers: ['Timestamp', 'Select Your Name', 'Tiebreaker'],
    submissions: [
      [new Date(WED), 'Alice', '45'],
      [new Date(SUN_PM), 'Alice', '38'],
      [new Date(SUN_PM), 'Bob', '99'],
    ],
    memberData: { members: { m1: { name: 'Alice' }, m2: { name: 'Bob' } }, memberOrder: ['m1', 'm2'] },
  };
  const run = (policy, now) => {
    const sim = makeTiebreakerSimulator(Object.assign({}, base, { policy }));
    return sim.runImport(sim.emptyCells(), now === undefined ? TUE : now);
  };

  it('freeze locks an on-time member out of changing their tiebreaker', () => {
    // The bug: Alice's picks correctly reverted to her pre-kickoff submission while her
    // tiebreaker kept the post-kickoff value, because the tiebreaker used the tiebreaker
    // game's kickoff as its only cutoff instead of following the policy's passes.
    assert.equal(run('freeze')[0], '45');
  });

  it('freeze still lets a member who never submitted on time enter one', () => {
    assert.equal(run('freeze')[1], '99');
  });

  it('none keeps last-submission-wins for the tiebreaker', () => {
    assert.deepEqual(run('none'), ['38', '99']);
  });

  it('close ignores a whole post-kickoff submission, tiebreaker included', () => {
    assert.deepEqual(run('close'), ['45', '']);
  });

  it('game locks the tiebreaker at its OWN game, so a change before it is legal', () => {
    // SUN_PM is after first kickoff but before the Monday tiebreaker game, so under
    // per-game rules Alice's update counts. This is the case that must NOT be "fixed".
    assert.deepEqual(run('game'), ['38', '99']);
  });

  it('freeze gives the same answer no matter when the operator imports', () => {
    const schedules = [[TUE], [WED + 3600000, TUE], [THU + 60000, SUN + 60000, TUE]];
    const results = schedules.map(times => {
      const sim = makeTiebreakerSimulator(Object.assign({}, base, { policy: 'freeze' }));
      let cells = sim.emptyCells();
      times.forEach(t => { cells = sim.runImport(cells, t); });
      return cells;
    });
    results.forEach(r => assert.deepEqual(r, results[0]));
    assert.equal(results[0][0], '45');
  });
});
