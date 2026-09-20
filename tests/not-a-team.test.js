'use strict';

const { describe, it, assert } = require('./run');
const { load } = require('./harness');

/**
 * "N/A" is not a team.
 *
 * The owner types N/A into a pick cell to mark a pick that will not be accepted.
 * Every "did this member pick?" test in the file was a bare truthiness check, and
 * "N/A" is a non-empty string, so it read as a submitted pick. That let a string
 * that is not a team acquire popularity in the wildcard consensus, become a
 * candidate winner in the win-probability simulation, and defeat the empty-row
 * guard written for exactly these members.
 *
 * Week 2 as it actually stood: 16 games, only the Thursday game final (BUF beat
 * DET). Five members had not submitted - N/A in the Thursday column, blank in the
 * other fifteen.
 */

const GAMES = 16;
/** The matchup row as weeklySheet writes it: "AWAY\n@HOME". */
const MATCHUPS = [['DET\n@BUF','PIT\n@NE','GB\n@NYJ','CLE\n@TB','NO\n@BAL','CIN\n@HOU',
  'CAR\n@ATL','MIN\n@CHI','PHI\n@TEN','LV\n@LAC','JAX\n@DEN','SEA\n@ARI','MIA\n@SF',
  'WSH\n@DAL','IND\n@KC','NYG\n@LAR']];
const nonSubmitter = () => ['N/A', ...Array(GAMES - 1).fill('')];
const submitter = (thursday) => [thursday, ...Array(GAMES - 1).fill('NE')];

describe('matchupTeams', () => {
  it('reads both sides out of a matchup cell', () => {
    const { matchupTeams } = load();
    assert.deepEqual(matchupTeams('DET\n@BUF'), ['DET', 'BUF']);
  });

  it('handles a cell written on one line', () => {
    const { matchupTeams } = load();
    assert.deepEqual(matchupTeams('DET@BUF'), ['DET', 'BUF']);
  });

  it('returns null for anything it cannot read', () => {
    const { matchupTeams } = load();
    for (const junk of ['', null, undefined, 'TBD', '???']) {
      assert.equal(matchupTeams(junk), null);
    }
  });
});

describe('isRealPick with the matchup known', () => {
  it('accepts either side of the game', () => {
    const { isRealPick } = load();
    assert.equal(isRealPick('BUF', ['DET', 'BUF']), true);
    assert.equal(isRealPick('DET', ['DET', 'BUF']), true);
  });

  it('rejects a team that is not in this game', () => {
    // The whole point of the stronger check: a pick naming a real NFL team that
    // is not playing in this matchup is still not a pick for this matchup.
    const { isRealPick } = load();
    assert.equal(isRealPick('KC', ['DET', 'BUF']), false);
  });

  it('rejects anything a commissioner might type, not just N/A', () => {
    const { isRealPick } = load();
    for (const junk of ['N/A', '--', 'missed', 'late', 'xx', '?']) {
      assert.equal(isRealPick(junk, ['DET', 'BUF']), false, `${junk} is not a team`);
    }
  });

  it('is case and space insensitive about a real pick', () => {
    const { isRealPick } = load();
    assert.equal(isRealPick(' buf ', ['DET', 'BUF']), true);
  });
});

describe('isRealPick falling back, for sheets built before the change', () => {
  it('still rejects N/A and blanks when the matchup is unknown', () => {
    // An existing weekly sheet calls these functions with the old argument
    // count. Those sheets must keep working until rebuilt, not silently start
    // counting everything again.
    const { isRealPick } = load();
    assert.equal(isRealPick('N/A', undefined), false);
    assert.equal(isRealPick('', undefined), false);
    assert.equal(isRealPick('   ', undefined), false);
  });

  it('accepts any other string when the matchup is unknown', () => {
    // It cannot do better without knowing who is playing - and accepting a real
    // pick matters more than rejecting a typo.
    const { isRealPick } = load();
    assert.equal(isRealPick('BUF', undefined), true);
  });
});

describe('isRealPick', () => {
  it('accepts a team', () => {
    const { isRealPick } = load();
    assert.equal(isRealPick('BUF'), true);
  });

  it('rejects N/A, however it is typed', () => {
    const { isRealPick } = load();
    for (const raw of ['N/A', 'n/a', ' N/A ', 'N/a']) {
      assert.equal(isRealPick(raw), false, `${JSON.stringify(raw)} should not be a pick`);
    }
  });

  it('rejects a blank cell', () => {
    const { isRealPick } = load();
    for (const raw of ['', null, undefined, '   ']) {
      assert.equal(isRealPick(raw), false);
    }
  });

  it('does not reject a team that merely contains those letters', () => {
    // Guard against a sloppier check catching real abbreviations.
    const { isRealPick } = load();
    for (const team of ['NE', 'NO', 'NYJ', 'NYG', 'ATL']) {
      assert.equal(isRealPick(team), true, `${team} is a real team`);
    }
  });
});

describe('calculateWildcardScore with N/A rows', () => {
  const grid = () => [
    ...Array(5).fill(null).map(nonSubmitter),
    ...Array(8).fill(null).map(() => submitter('BUF')),
    ...Array(3).fill(null).map(() => submitter('DET')),
  ];

  it('blanks a member who picked no team, instead of scoring them', () => {
    // The empty-row guard exists for exactly these members and was defeated by
    // the single character marking them.
    const { calculateWildcardScore } = load();
    const out = calculateWildcardScore(grid(), MATCHUPS);
    for (let i = 0; i < 5; i++) {
      assert.equal(out[i][0], '', `non-submitter row ${i} should be blank`);
    }
  });

  it('does not let N/A skew the consensus for everyone else', () => {
    // With N/A counted, a phantom team took a share of the Thursday popularity
    // and every real member's score moved.
    const { calculateWildcardScore } = load();
    const withNa = calculateWildcardScore(grid(), MATCHUPS);
    const withoutNa = calculateWildcardScore(grid().slice(5), MATCHUPS);
    for (let i = 0; i < withoutNa.length; i++) {
      assert.equal(
        withNa[i + 5][0],
        withoutNa[i][0],
        `submitter ${i}'s score must not depend on whether N/A rows are present`,
      );
    }
  });
});

describe('calculateWinProbability with N/A rows', () => {
  // Only the Thursday game is graded; the other fifteen are still to come.
  const results = ['BUF', ...Array(GAMES - 1).fill('')];
  const bonus = [Array(GAMES).fill(1)];
  const spreads = [Array(GAMES).fill('')];

  const run = (picks, scores) => {
    const { calculateWinProbability } = load();
    return calculateWinProbability(
      picks,
      [results],
      scores.map((s) => [s]),
      bonus,
      picks.map(() => ['']),
      spreads,
      MATCHUPS,
    );
  };

  it('leaves a member with nothing but N/A out of the running', () => {
    const picks = [
      Array(GAMES).fill('N/A'),
      submitter('BUF'),
      submitter('DET'),
    ];
    const out = run(picks, [0, 1, 0]);
    assert.equal(out[0][0], '', 'a row of nothing but N/A holds no team');
  });

  it('never makes N/A a candidate winner in an ungraded game', () => {
    // The hazard: if a column's only truthy picks were {a team, "N/A"}, then
    // "N/A" entered the simulation as a hypothetical winner carrying half the
    // probability mass, and the N/A cells matched it and were credited.
    const picks = [
      ['BUF', 'KC', ...Array(GAMES - 2).fill('SF')],
      ['BUF', 'N/A', ...Array(GAMES - 2).fill('SF')],
      ['DET', 'N/A', ...Array(GAMES - 2).fill('SF')],
    ];
    const out = run(picks, [1, 1, 0]);
    // Game 1 has one real pick (KC), so it is not a contested game at all and
    // cannot swing anything. The two members on 1 point split it; the member on
    // 0 cannot catch up, because N/A earns nothing.
    assert.equal(out[2][0], 0, 'an N/A pick must not earn a hypothetical win');
    assert.ok(Math.abs(out[0][0] + out[1][0] - 1) < 1e-9);
  });

  it('leaves the probabilities summing to one', () => {
    const picks = [
      ...Array(2).fill(null).map(nonSubmitter),
      submitter('BUF'),
      submitter('DET'),
    ];
    const out = run(picks, [0, 0, 1, 0]);
    const total = out.reduce((sum, [p]) => sum + (typeof p === 'number' ? p : 0), 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `probabilities summed to ${total}`);
  });

  it('does not dilute real members before any game is graded', () => {
    // At lock time every score is blank, the all-tied branch splits evenly, and
    // N/A rows used to take a share - diluting everyone and printing
    // "EVERYONE IS IN" when several members had not submitted.
    const { calculateWinProbability } = load();
    const picks = [
      ...Array(2).fill(null).map(nonSubmitter),
      submitter('BUF'),
      submitter('DET'),
    ];
    const out = calculateWinProbability(
      picks,
      [Array(GAMES).fill('')],
      picks.map(() => ['']),
      bonus,
      picks.map(() => ['']),
      spreads,
      MATCHUPS,
    );
    assert.equal(out[0][0], '', 'a non-submitter is not in the running');
    assert.equal(out[2][0], 0.5, 'the two real submitters split it');
    assert.equal(out[3][0], 0.5);
  });
});
