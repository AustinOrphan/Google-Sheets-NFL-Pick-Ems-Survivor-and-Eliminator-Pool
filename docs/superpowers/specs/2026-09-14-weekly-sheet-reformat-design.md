# Reapply Formatting — Design

**Date:** 2026-09-14
**Status:** Approved architecture, phase 1 scoped
**Target:** `picks.gs` (11,888 lines, single file, no test suite)

## Problem

There is no way to repair the formatting on a sheet that has drifted. Every sheet
except the weekly ones can be rebuilt from the "📊 Deploy / Refresh Sheets" menu,
which is safe because those sheets are formula-driven and hold no original data.
Weekly sheets hold the picks. Their only rebuild path is `weeklySheet(..., rebuild=true)`
(`picks.gs:9811`), reachable from exactly one caller — `executePickImport`
(`picks.gs:5435`) — and only when it detects a missing member.

So the sheets that most need a repair tool are the only ones without one.

## Approach

Split each sheet builder three ways:

```
computeLayout(week, config, forms, memberData, observed)  → layout   (no sheet mutation)
           observed = { displayEmpty, memberNames } read off the sheet — see below
writeContent(sheet, layout)                               → values, formulas, named ranges
applyFormatting(sheet, layout)                            → formats, validation, notes, widths
```

Both entry points fall out of it:

- `weeklySheet(...)` = `computeLayout` → scrape → nuke → `writeContent` → `applyFormatting` → restore
- `reformatWeeklySheet(week)` = read sheet → `computeLayout` → **verify** → `applyFormatting`

`reformatWeeklySheet` never clears the sheet, never writes a value or a formula, and
never resizes the grid.

### Formulas are out of scope

Formulas have their own repair path in "🧮 Update Formulas" (`allFormulasUpdate`,
`picks.gs:9767`). Keeping that boundary means a reformat can never corrupt a pick, and
it keeps the diff reviewable. One exception needs handling — the paid summary
formula, section 8 below.

## What the recon changed

Six parallel readers mapped the file and eighteen adversarial verifiers attacked their
conclusions. The verified findings below alter the design rather than merely detail it.

### 1. `computeLayout` cannot be pure from config alone

The member row set — and therefore `entryRowEnd`, `summaryRow`, `spreadRow`,
`outcomeRow`, `outcomeMarginRow`, `spreadOutcomeRow`, `bonusRow`, `rows`, `finalCol`,
`diffCount`, and every formula row reference — is selected by the `displayEmpty`
argument (`picks.gs:9827-9840`), which the caller derives from `config.hideNonParticipants`
at `picks.gs:5431`. It chooses between all of `memberData.memberOrder` and
respondents-only, and `forms[week].respondents` is rewritten on every sync
(`picks.gs:6633`).

Nothing recorded on the sheet says which mode built it. Recomputing the layout from
current config can therefore disagree with a perfectly healthy sheet by N rows, and
verify would report a false mismatch.

**Resolution.** `reformatWeeklySheet` reads the authoritative member list off the sheet
first — `NAMES_{week}`, the technique `getExistingWeeklySheetData` already uses at
`picks.gs:10930` — and passes it in:

```js
computeWeeklyLayout(week, config, forms, memberData, { displayEmpty, memberNames })
```

Layout math is parameterized by the observed row set instead of re-deriving it. If the
`NAMES_{week}` height disagrees with `memberData`, that is a verify failure with an
actionable message ("run Check & Import Responses to rebuild the grid"), not a
formatting job.

`computeLayout` must also return `null`, not throw, when `forms?.[week]?.gamePlan` is
absent. Today `picks.gs:9817` dereferences `forms[week].gamePlan` unguarded, so any week
without a forms entry throws `TypeError`. A "reformat all weeks" loop would hit this on
the first gap.

### 2. `insertCheckboxes()` destroys paid status

`picks.gs:10629`:

```js
sheet.getRange(entryRowStart,paidCol,totalMembers,1)
  .insertCheckboxes().setFontSize(11).setHorizontalAlignment('center');
```

`Range.insertCheckboxes()` installs checkbox validation **and sets every cell in the
range to `false`**. It sits inside the block the code itself labels "conditional
formatting rules to indicate paid status", so a naive extraction sweeps it into
`applyFormatting` and every reformat silently un-pays the whole pool.

**Resolution.** `writeContent` owns `insertCheckboxes` (creation only). `applyFormatting`
keeps `.setFontSize(11).setHorizontalAlignment('center')` and, where it needs to assert
checkbox presence, uses:

```js
range.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
```

which installs the same validation without touching values.

> **This is already a live bug, independent of the refactor.**
> `getExistingWeeklySheetData` and `remapAndRepopulateData` (`picks.gs:10925-11091`)
> scrape and restore names, picks, tiebreakers, comments, outcomes, margins, and
> spreads. They never touch paid — `grep -ci paid` across that range returns 0. So every
> member-expansion rebuild, which fires automatically during import at `picks.gs:5435`,
> already wipes every paid checkbox. Tracked as a separate fix below.

### 3. Verify must assert the grid, never repair it

`adjustRows` (`picks.gs:11565`) and `adjustColumns` (`picks.gs:11582`) read the sheet
dimensions and then **insert or delete** rows and columns. In a build path that is a
structural precondition. In a reformat path `deleteColumns` would destroy pick columns.

`applyFormatting` must never call either. Verify asserts
`getMaxRows() === layout.rows` and `getMaxColumns() === layout.finalCol` and aborts on
mismatch.

This matters more than it looks. `maxCols === finalCol` holds on the build path *only
because* `adjustColumns(sheet, finalCol)` at `picks.gs:10066` forces it. The refactor
removes the forcing function from the reformat path, so the invariant stops being
intrinsic and has to be checked.

### 4. Named ranges are write-path only

Every per-week named range (`NAMES_n`, `NFL_PICKS_n`, `NFL_TIEBREAKER_n`, `COMMENTS_n`,
`TOT_n`, `RNK_n`, `PCT_n`, `CHANCES_n`, `WILDCARD_n`, `WIN_n`, `MNF_n`) is sized from
`totalMembers` and `matchups`. `ss.setNamedRange` re-points an existing name, and
TOTAL/RNK/PCT/MNF/WINNERS resolve these names through `INDIRECT`
(`picks.gs:7278, 9706, 9710, 9714, 9762`).

If the recomputed `totalMembers` disagrees with the rows actually on the sheet,
re-setting `NAMES_n` slides it over the summary and outcome rows, and every downstream
`FILTER`/`VLOOKUP` returns wrong data with no error anywhere.

**Resolution.** `reformatWeeklySheet` calls `ss.setNamedRange` zero times. Verify
compares the live ranges against the layout and aborts. It does not repair them.

### 5. The fingerprint must fail closed

The obvious identity check — the outcome-row data validation, read back by
`outcomeDataValidationMapping` (`picks.gs:3487`) — **fails partially open**. Missing or
mismatched validations are skipped with a bare `Logger.log` (`picks.gs:3529-3543`); a
single surviving match returns a truthy, incomplete map (`picks.gs:3546-3549`); and its
one completeness flag, `allValid`, is an undeclared implicit global written at
`picks.gs:3531/3539` and never read anywhere in the file.

**Resolution.** Verify does not use it. The fingerprint is a strict, all-or-nothing
comparison of row 1 against `layout.headers` (normalizing the `AWAY\n@HOME` newline and
trailing whitespace), plus the dimension and named-range assertions above.

Day colors make the stakes concrete: `subHeaderRowColors` is built positionally from
`gamePlan.dayName` and applied positionally at `picks.gs:10710` with no reference to
what is actually in those columns. Same exposure at `picks.gs:10741-10742` (away/home
colors pinned to literal columns 5 and 6) and `picks.gs:10450` (MNF gradient pinned to
`mnfCol`). Reformatting a sheet whose schedule has since changed paints the wrong
columns and produces a *worse* sheet than it started with.

### 6. Tab color is spreadsheet-scoped

`weeklySheetTabColors` (`picks.gs:10846`) repaints the tab of every WK sheet from
`week-1` down to 1, and discovers them by probing `ss.getSheetByName` in a loop. It
cannot be expressed as `applyFormatting(sheet, layout)`.

**Resolution.** It stays out of the per-sheet contract. The entry point calls
`weeklySheetTabColors(ss, maxWeek, true)` once after the loop finishes.

### 7. `applyFormatting` needs a blank canvas

For TOT/RNK/PCT, `sheet.clear()` (`picks.gs:7253, 7352, 7447`) is the only thing that
removes stale formatting from the body. Nothing ever paints rows `2..totalMembers+1`
explicitly — only row 1 and the averages row. A reformat that must never clear cannot
restore a clean sheet; leftover backgrounds from a prior member count survive untouched.

**Resolution.** `applyFormatting` opens with
`sheet.getRange(1, 1, layout.rows, layout.finalCol).clearFormat()`. `clearFormat()` resets
cell formatting only — values, formulas, notes, and data validation survive — so it
honours the contract while giving the same blank canvas `clear()` provided. Column
widths, frozen panes, and conditional rules are sheet-scoped and unaffected, so they
must still be re-applied explicitly. They already are.

### 8. The paid summary formula is fused to a format chain

`picks.gs:10631-10635` is a single chained expression:

```js
finalPaidCell.setHorizontalAlignment('center')
  .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
  .setFontWeight('bold')
  .setNumberFormat("##.#%")
  .setFormulaR1C1(`=if(and(...),"ALL PAID",...)`);
```

Four format calls terminating in a formula write. The formula is not a separable
statement, and it is not covered by `allFormulasUpdate` either, so it has no repair path
of its own today.

**Resolution.** Break the chain into two statements. The formula moves to `writeContent`
as `layout.paid.summaryFormula` and gets registered with `allFormulasUpdate`. The four
format calls stay in `applyFormatting`. Confirm the split does not change the effective
result — `setNumberFormat('##.#%')` must still apply.

## Banned APIs

`applyFormatting` and everything it calls must never invoke:

`setValue` · `setValues` · `setFormula` · `setFormulaR1C1` · `setFormulas` ·
`clear()` · `clearContents` · `insertCheckboxes` · `adjustRows` · `adjustColumns` ·
`ss.setNamedRange`

`clearFormat` is permitted and required. Enforce the list with a grep over the extracted
functions during review.

## Verify algorithm

```
reformatWeeklySheet(week):
  sheet    = ss.getSheetByName(`WK${week}`)              → abort if missing
  names    = ss.getRangeByName(`NAMES_${week}`)          → abort if missing
  observed = names.getValues().flat().filter(nonEmpty)
  layout   = computeWeeklyLayout(week, config, forms, memberData,
                                 { displayEmpty, memberNames: observed })
             → abort if null (no gamePlan for this week)

  assert sheet.getMaxRows()    === layout.rows
  assert sheet.getMaxColumns() === layout.finalCol
  assert normalize(row 1)      === normalize(layout.headers)     // strict, all-or-nothing
  assert names.getRow()        === layout.entryRowStart
  assert names.getNumRows()    === observed.length
  assert paid column carries checkbox validation (if config.paidCheckboxes)

  on any failure → abort with the specific mismatch and the remedy
                   ("Week N's matchups no longer match the schedule —
                     use Deploy / Refresh to rebuild instead")

  applyWeeklyFormatting(sheet, layout)
```

Abort means abort. The tool does not guess, does not partially apply, and does not
repair structure.

## Pre-existing defects fixed as part of the move

These sit inside the code being relocated. Moving them unexamined would preserve bugs
in a new home.

1. **`picks.gs:9951` — day rules all target one cell.**
   `sheet.getRange(subHeaderRow, firstMatchupCol+(matchups-1))` uses `matchups`, the
   loop-invariant `contests.length`, so every iteration targets the *last* matchup
   column. The day-fill-on-completion highlight has only ever applied to the final game
   of the week. Should be `firstMatchupCol + Number(a)`.

2. **`picks.gs:9957-9958` — builder pushed instead of rule.**
   `rule.build()` is called and its return value discarded, then the *builder* is pushed
   onto `formatRules`. `setConditionalFormatRules` (`picks.gs:10674`) expects built
   `ConditionalFormatRule` objects. Confirm the runtime behaviour during implementation,
   then push `rule.build()`.

3. **`picks.gs:10066` — `adjustColumns` ordering regression.**
   `adjustColumns(sheet, finalCol)` runs 163 lines after `adjustRows` at `picks.gs:9903`,
   and eight writes land on columns that may not exist yet: `setDataValidation` at 9969
   and `setNote` at 9990, 9991, 10011, 10024, 10036, 10047, 10060. A freshly inserted
   sheet has 26 columns; a 13–16 game week with comments and paid enabled needs more.
   `getRange` throws beyond `maxColumns`.

   Every other builder pairs the two calls immediately and before any write
   (`picks.gs:2737, 7714, 8373, 8906, 8969, 9143, 9333, 9664`). `weeklySheet` is the sole
   exception, and it is a regression: commit `9db3bd3` ("Updated to new weeklySheet
   code") introduced the `setNote` calls into a window the prior version kept safe. It is
   invisible today because the only caller sits inside a try/catch that logs and toasts
   (`picks.gs:5415, 5518-5521`).

   Fix by having `writeContent` size the grid before any write — build path only.

4. **Paid status is never preserved on rebuild.** Add the paid column to the
   scrape/restore pair in `getExistingWeeklySheetData` / `remapAndRepopulateData`. This
   is independent of the reformat feature and fixes live data loss on every import that
   expands the member list.

5. **Number-format ownership conflict (TOT/RNK/PCT).**
   `overallPrimaryFormulas` (`picks.gs:9674-9690`) and `overallMainFormulas`
   (`picks.gs:9717-9757`) set number formats chained onto `setFormulaR1C1`. They
   overwrite the in-body `setNumberFormat` calls at `picks.gs:7292` and `picks.gs:7482`,
   which are therefore dead code. `applyFormatting` must take ownership with explicit
   range-level calls, and the `setNumberFormat` calls must be stripped out of both
   formula helpers at the same time — otherwise `allFormulasUpdate` and `applyFormatting`
   fight over the same cells.

## Phase 1 deliverable

1. `computeWeeklyLayout` / `writeWeeklyContent` / `applyWeeklyFormatting` extracted from
   `weeklySheet`, with `weeklySheet` rewritten to compose them. Behaviour unchanged on
   the build path except the defect fixes above.
2. The same split for `totSheet` / `rnkSheet` / `pctSheet` — near-identical twins, ~9
   formatting calls each. Cheap proof the contract generalizes.
3. `reformatWeeklySheet(week)` plus the verify step.
4. A "🎨 Reapply Formatting" item in the Utilities submenu (`picks.gs:140-160`),
   following the `deploy*` wrapper pattern at `picks.gs:7128-7237` and gated on
   `config.pickemsInclude` like its neighbours. Prompts for a week or all weeks; builds
   its candidate list as the intersection of `Object.keys(formsData)` (the idiom already
   used at `picks.gs:7826`) and the WK sheets that exist; reports skipped weeks in the
   closing toast.

Deferred to later specs: leaderboard/season/summary (phase 3) and the mid-tier
mnf/outcomes/contrarian/counts/winners/survElim (phase 2).

## Testing

There is no test suite and Apps Script cannot be run locally, so verification is manual
against a copy of the spreadsheet. Before/after checks per sheet:

- Reformat a healthy sheet → no cell value changes, no formula changes, paid checkboxes
  retain their ticks, formatting visibly identical.
- Reformat a sheet with a manually broken background/width → repaired.
- Reformat a sheet whose gamePlan no longer matches → aborts with the specific message,
  changes nothing.
- Reformat a week with no forms entry → skipped and reported, no throw.
- Confirm `TOT_OVERALL`, `NAMES_n`, `NFL_PICKS_n` still resolve after a reformat, and
  that TOTAL/RNK/PCT/MNF/WINNERS show unchanged values.

Record the before/after of a populated week explicitly — the paid column is the canary
for a leaked value write, and the spread row is the canary for a leaked content write.
