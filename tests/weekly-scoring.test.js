'use strict';

const { describe, it, assert } = require('./run');
const fs = require('node:fs');
const { PICKS_PATH } = require('./harness');

/**
 * The weekly points and percent formulas.
 *
 * These are spreadsheet formulas, so they cannot be executed here. What CAN be
 * checked is the property that broke: the points formula must exclude games with
 * no outcome yet, exactly as the percent formula beside it always has.
 *
 * The failure this pins: mid-week, a member who has not submitted has blank pick
 * cells. A game not yet played has a blank outcome cell. Sheets reads blank =
 * blank as equal, so without the guard every unplayed game scored as a correct
 * pick. With one of sixteen games played, non-submitters showed 15 points and
 * ranked first, while their percent - which had the guard - correctly read 0.0%.
 * The two columns disagreeing with each other is the tell.
 *
 * It only appears while a week is PARTLY graded. A single import after every
 * game has finished leaves no blank outcomes, which is why it stayed hidden
 * until the outcome auto-fetch began importing mid-week.
 */

const source = fs.readFileSync(PICKS_PATH, 'utf8');

const formulaLine = (name) => {
  const match = new RegExp(`const ${name} = \`([^\`]*)\``).exec(source);
  assert.ok(match, `${name} not found in picks.gs`);
  return match[1];
};

describe('weekly points formula', () => {
  it('excludes games with no outcome yet', () => {
    // Without this term, blank pick = blank outcome counts as correct.
    assert.match(formulaLine('pointsFormula'), /--\(\$\{outcomesRange\}<>""\)/);
  });

  it('still multiplies by the bonus range', () => {
    // The guard must be an extra SUMPRODUCT term, not a replacement for bonuses.
    assert.match(formulaLine('pointsFormula'), /\$\{allBonusRange\}/);
  });

  it('still compares picks against outcomes', () => {
    assert.match(formulaLine('pointsFormula'), /--\(\$\{picksRange\}=\$\{outcomesRange\}\)/);
  });

  it('only scores once at least one outcome exists', () => {
    // A week with nothing graded must leave the column blank, not zero, so an
    // ungraded week does not rank everybody equal-last.
    assert.match(formulaLine('pointsFormula'), /COUNTA\(\$\{outcomesRange\}\) > 0/);
  });

  it('guards the same way the percent formula does', () => {
    // These two describe the same scoring rule. They disagreeing is the bug.
    const points = formulaLine('pointsFormula');
    const percent = formulaLine('percentFormula');
    const guard = /--\(\$\{outcomesRange\}<>""\)/;
    assert.equal(
      guard.test(points),
      guard.test(percent),
      'points and percent must both exclude ungraded games, or neither',
    );
  });
});

describe('the arithmetic the guard fixes', () => {
  /** Minimal stand-in for SUMPRODUCT(--(picks=outcomes), [--(outcomes<>"")], bonus). */
  const score = (picks, outcomes, bonus, guarded) =>
    picks.reduce((total, pick, i) => {
      const matches = pick === outcomes[i];
      const graded = outcomes[i] !== '';
      return total + (matches && (!guarded || graded) ? bonus[i] : 0);
    }, 0);

  // Week 2 as it actually stood: 16 games, only the Thursday game final.
  const outcomes = ['BUF', ...Array(15).fill('')];
  const bonus = Array(16).fill(1);

  it('scored a non-submitter 15 before the fix', () => {
    const noPicks = ['N/A', ...Array(15).fill('')];
    assert.equal(score(noPicks, outcomes, bonus, false), 15);
  });

  it('scores that same non-submitter 0 after it', () => {
    const noPicks = ['N/A', ...Array(15).fill('')];
    assert.equal(score(noPicks, outcomes, bonus, true), 0);
  });

  it('leaves a correct submitter on 1 either way', () => {
    // The guard must not cost anyone a point they earned - which is why the bug
    // was invisible in the rows that mattered most to check.
    const rightPick = ['BUF', ...Array(15).fill('NE')];
    assert.equal(score(rightPick, outcomes, bonus, false), 1);
    assert.equal(score(rightPick, outcomes, bonus, true), 1);
  });

  it('leaves a wrong submitter on 0 either way', () => {
    const wrongPick = ['DET', ...Array(15).fill('NE')];
    assert.equal(score(wrongPick, outcomes, bonus, false), 0);
    assert.equal(score(wrongPick, outcomes, bonus, true), 0);
  });

  it('agrees with the unguarded version once every game is graded', () => {
    // Why a single end-of-week import never showed this: with no blank outcomes
    // the guard changes nothing, so the bug is invisible outside a partly
    // graded week.
    const allGraded = Array(16).fill('BUF');
    const picks = ['BUF', 'BUF', ...Array(14).fill('NE')];
    assert.equal(
      score(picks, allGraded, bonus, false),
      score(picks, allGraded, bonus, true),
    );
  });

  it('honours a bonus multiplier on a graded game', () => {
    const doubled = [2, ...Array(15).fill(1)];
    assert.equal(score(['BUF', ...Array(15).fill('')], outcomes, doubled, true), 2);
  });
});
