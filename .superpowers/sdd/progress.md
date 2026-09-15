# Reapply Formatting — SDD progress ledger

Plan: docs/superpowers/plans/2026-09-14-reapply-formatting.md
Branch: feat/reapply-formatting
Base: cc9e091 (plan commit)

Executing tasks: 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
(Task 3 folded into Task 5 during pre-flight — numbering kept so cross-refs stay valid.)

## Completed

Task 1: implemented (28513dd), review found 2 Critical + 2 Important, fix pass in flight.
  - C1 bodyOf brace counter not comment-aware -> bodyOf('weeklySheet') returned null,
    walker silently skipped it. Confirmed independently.
  - C2 gate skipped unparseable functions and still exited 0. Now must fail loudly.
  - I3 .clearContent( (Range, singular) was unguarded; picks.gs:7079-7080 uses it.
    Plan + spec banned lists corrected upstream.
  - I4 .clear() regex only matched empty parens.

Minor findings deferred to final whole-branch review triage:
  - M5 two separate name scanners (topLevelNames in harness.js vs declaredFunctionNames
    in banned-apis.js) with overlapping non-identical regexes; could share one.
  - M6 unescaped identifier interpolation into new RegExp in bodyOf and callee detection.
  - M7 topLevelNames misses destructuring and comma-chained declarations; a miss is
    silent (name absent from shim) rather than an error.
  - Re-review found 2 NEW Critical silent bypasses (reproduced independently):
      A. concise-body arrow helper: bodyOf walks past it to an unrelated brace, never
         scans the body. Gate said "clean" exit 0 with a live setValue.
      B. bare-reference callee (.forEach(fn)): never enqueued, body never scanned.
    Fix pass 2 in flight. picks.gs has 0 top-level concise arrows, so failing loudly
    on them costs nothing today.
  - Plan now states the gate is a heuristic backstop, not a proof; Task 8 manual
    canaries (paid checkbox + hand-entered spread) are the authoritative check.
  - SCOPE CAP: if a 3rd round of Criticals lands on this gate, accept it as heuristic
    and move on rather than pursuing exhaustive static analysis.

Task 1: COMPLETE (commits 28513dd..e1e0a85, 2 fix passes)
  Verified by controller directly against the fixed gate (md5-matched copy), 5 cases:
    concise-arrow -> fails loudly | bare-ref callee -> BANNED caught
    direct write -> caught | clean code -> passes | missing clearFormat -> caught
  Third review round deliberately skipped (scope cap). FINAL REVIEW MUST RE-EXAMINE
  tests/banned-apis.js - two rounds found 2 Criticals each; also check whether Fix B's
  bare-word traversal causes noise once applyWeeklyFormatting actually exists (Task 5).
  Note: .superpowers/sdd/.gitignore is `*`, so only progress.md is force-tracked;
  task-N-report.md files are local scratch and will not survive a clean checkout.

Task 2: implemented (8c38376) + fix pass (17949ef). Review: spec OK, fidelity CLEAN
  (14336 differential cases vs original geometry, 0 divergences; 2048 refThrows were
  exactly the n=1 RangeError the fix addresses).
  2 Important -> gate fix pass in flight:
    I-1 purity test is fake (harness Proxy swallows writes; reviewer injected setValue
        and suite still reported 15 passed). Purity unenforced by anything.
    I-2 a COMMENT at picks.gs:10052 naming weeklySheet drags all 1033 of its lines into
        the gate's bare-word callee scan -> would turn Task 5 red with false positives.
        Direct fallout from my fix-pass-2 over-approximation decision.
  Minor deferred to final review: displayEmpty:false branch untested; isAts always true
  in fixtures so baseFormulas ATS switch never exercised; several tautological assertions
  (rows===bonusRow, d.key vs own fields, newMatchupMap value never checked); day-colour
  fallbacks untested; mixed -1/undefined sentinels (now a plan constraint); contests is a
  live alias not a copy.
  Follow-up for Task 13: chancesCol note reads config.pickemsAts while layout.isAts reads
  gamePlan.pickemsAts - two sources, can disagree. Ported verbatim, not reconciled.
Task 2: COMPLETE (commits 8c38376..9ecb36c, 2 fix passes, review fidelity-clean)
  Gate now has entry KINDS: 'formatting' (banned writes + required clearFormat) and
  'pure' (bans all Apps Script surface). computeWeeklyLayout registered as pure.
  Comment/string stripping before callee discovery killed the false-positive class;
  verified picks.gs:10052 still contains the word weeklySheet and the gate stays clean.
Task 4: COMPLETE (commits ce00161..deeaa78, review APPROVED - fidelity clean, first-pass)
  331 insertions / 0 deletions; weeklySheet untouched. All 20 named ranges match, formula
  block byte-identical after stripping layout. prefix. 3 Minor (documentation only).
  Fixed a 3rd pre-existing crash: MNF summary guard used mnfCols.length>0 while mnfCol is
  only assigned under mnfInclude -> getRange(row, undefined) for any mnfExclude pool.
  Established for Task 5: all 7 maxCols reads in the original occur AFTER the old
  adjustColumns, so maxCols === finalCol at every one; layout.finalCol substitutes cleanly.
  Also: the paid chain drops SIX formatting calls to Task 5, not four (brief prose said
  four; plan Step 3 already carries all six).
Task 5: COMPLETE (commit f9f79d9, first pass, no fix pass needed)
  556 insertions / 0 deletions; weeklySheet, computeWeeklyLayout and writeWeeklyContent all
  byte-for-byte untouched. `npm run gate` is GREEN for the first time:
  "banned-api gate: clean (2 entry point(s))". npm test 15/15, node --check SYNTAX_OK.
  Task 1's open question answered: the bare-word callee traversal produces NO false positives
  now that applyWeeklyFormatting exists (hexGradient is the only function it pulls in).
  Fidelity verified by reconstructing the original ranges from the same file (weeklySheet
  shifted +556), stripping the layout. prefix, and diffing - every hunk is an enumerated delta.
  All 6 briefed deltas applied. Extra necessary substitutions (all documented in the report):
  maxCols/columns/getMaxColumns -> layout.finalCol (7+2+2 sites); subHeadersPriorLength
  re-derived as firstMatchupCol-1 (substituting at the use site would have been an off-by-one,
  caught in review); parities/baseFormulas/allPicksRange aliased so the 24-rule loop stays
  byte-identical; `let range` declared (it is an implicit global in weeklySheet); config
  predicates -> layout.mnfInclude/tiebreakerInclude/commentsInclude/config.bonusInclude;
  diffCol>0 guards at the 3 cohesion sites (Task 2 sentinel).
  CONCERNS for final review:
    C1 IMPORTANT: setBorder (pre-insert picks.gs:10720-10721) was moved even though the
       brief's source-range list omits it. It is unambiguously formatting, is NOT in
       writeWeeklyContent, and clearFormat erases borders - leaving it behind would have made
       Task 6 silently drop every row border. Only statement in the new function not traceable
       to a briefed range. Reviewer should confirm the call.
    C2 Validation ownership is now split: the tiebreaker requireNumberBetween(0,150) stayed in
       writeWeeklyContent (Task 4), the other four validations are in applyWeeklyFormatting.
       Benign (clearFormat does not drop validations) but asymmetric. Decide at Task 13.
    C3 clearFormat's rectangle is layout-sized, not sheet-sized; stale formatting outside
       rows x finalCol survives a reformat-only run. Safe ONLY because Task 6's verify step
       asserts the dimensions - do not soften that assertion.
    C4/C5 pre-existing, moved verbatim: hideRows is one-way (never un-hides if config flips);
       Logger.log(teamData) still logs all 32 teams per reformat despite commit d1c930c's
       title "Remove Logger.log for team data".
  MANUAL, still pending: brief Step 8b (day-coloration fix) and plan Task 8 canaries (ticked
  paid checkbox + hand-entered spread must survive a reformat). BOTH are only observable after
  Task 6 rewires weeklySheet - Step 8b as written says to run weeklySheet(null,5), which today
  still executes the ORIGINAL body. Re-schedule 8b to Task 6/8.
  Deliberately NOT written: any test that drives applyWeeklyFormatting through the harness
  stubs. A scratch-only diagnostic confirmed no free variable is undefined on 4 branch shapes
  (incl. the single-member diffCol=-1 case) - sound because no re-homed name collides with a
  picks.gs global - but it asserts nothing about formatting and was not added to tests/.
Task 5: COMPLETE (commits f9f79d9..279cc93, review APPROVED - no Critical/Important)
  Reviewer proved data safety at RUNTIME, not statically: recording Proxy over `sheet`,
  3 configs, complete observed method set = 25, zero mutating. Fidelity: 39 forward
  unmatched lines all = enumerated deltas; 46 reverse unmatched all accounted for.
  Gate GREEN for the first time (2 entry points).
  Confirmed setBorder judgment call correct (writeWeeklyContent has 0 setBorder; clearFormat
  erases borders, so leaving it would have dropped every row border at Task 6).

  *** HYPOTHESIS RAISED THEN REFUTED - see correction below ***
  Original pushed a BUILDER into formatRules; setConditionalFormatRules rejects builders.
  That call is at picks.gs:11835 with 28 static-formatting calls AND the data restore after
  it, all inside the try/catch at 5415 that only toasts. So the original may have been
  losing ALL conditional + static formatting on every build. This is a strong candidate for
  the root cause of the user's original request. Record rule counts + check Executions log.

  Carry-forward to Task 6 review: clearFormat's rectangle is layout.rows x layout.finalCol,
  NOT sheet-sized. Task 6's dimension assertion is what makes that safe - if it is ever
  softened, stale formatting outside the rectangle survives a reformat. Flag it.
  Follow-up: Logger.log(teamData) logs all 32 teams per reformat (commit d1c930c removed
  the leaderboardSheet twin, never scoped the weeklySheet copy).
Task 6: COMPLETE (commit 17f108e, first pass). weeklySheet 1033 -> 59 lines;
  32 insertions / 1008 deletions. npm test 15/15, npm run gate "clean (2 entry point(s))",
  node --check SYNTAX_OK, sole caller at picks.gs:5435 unchanged (7 args).
  Accounting method: comment-stripped, normalised MULTISET comparison of the old body's 740
  logical statements against the three extracted bodies. 652 matched exactly; the 88 residual
  were adjudicated individually into 6 groups (see task-6-report.md).
  writeWeeklyContent gained the `forms` 5th parameter; the layout.contests stand-in is gone.
  THIRTEEN STATEMENTS WERE GENUINELY ORPHANED and are re-homed in weeklySheet from layout:
    - the `totalMembers <= 0` guard + SpreadsheetApp.getUi() alert + log + return null.
      computeWeeklyLayout is kind:'pure' and cannot call getUi(); it returns null only for a
      missing gamePlan, a path the pickemsInclude guard already covers. The brief's
      `if (!layout) return null` therefore does NOT cover a zero-member pool. Ordering is
      preserved exactly - computeWeeklyLayout touches nothing.
    - 8 pool-config diagnostic logs (tiebreaker/MNF/comments/paid, both branches) re-emitted
      as 4 ternaries off layout.tiebreakerInclude/mnfInclude/commentsInclude/paidCheckboxes.
    - the per-MNF-game `🔍 MNF Added in Column` log, from matchupDescriptors.filter(isMnf).
      Verified mechanically that descriptor.col === the original's headers.length+1 across 4
      game shapes incl. a mid-week Monday-evening game (scratchpad check, NOT added to tests/).
    - the `🌏 Map created of new matchups` log, from written.existingData/newMatchupMap.
  This is why the function is 59 lines, not the brief's "<45". Log ORDERING shifts (config logs
  now precede the scrape/clean logs; the map log now follows the restore) - content complete.
  HYPOTHESIS CONFIRMED AT SOURCE LEVEL: the old body pushed a conditional-format BUILDER into
  formatRules (old 11113-11119: `rule.build();` discards the return, then pushes `rule`).
  setConditionalFormatRules rejects builders, so old picks.gs:11835 threw on every build, losing
  55 downstream sheet-mutating statements (alignment, frozen panes, row heights, ALL column
  widths, every merge) AND the data restore AND weeklySheetTabColors - swallowed by the
  log-and-toast-only catch at picks.gs:5518. Likely root cause of the original complaint.
  NOT verified at runtime; Step 4b is the authoritative check.
  MANUAL STEPS 4, 4b AND 5 ARE ALL PENDING - none can be run locally, none are claimed passing.
  CONCERNS for final review:
    C1 The member guard and the 10 re-homed logs are additions the brief's template omitted.
       A reviewer who wants them dropped or relocated should overrule deliberately.
    C2 Task 5's C1 (moved setBorder) and C2 (split validation ownership) are inherited
       unexamined - this task's deletion is what makes either mistake permanent.
    C3 getExistingWeeklySheetData now receives the real `forms` - strictly more correct, but a
       live behaviour change on the rebuild path exercised only by manual Step 5.

CORRECTION (Task 6 review): the full-formatting-loss hypothesis was OVERSTATED by the
  controller. Source facts hold (builder pushed; 55 statements + data restore after the call;
  caller only toasts). But the reviewer ran the decisive check: the builder push dates to the
  repo's FIRST commit 8088d09 (2025-09-04) and survived to 2026-09-10. weeklySheet is called
  only from the import path; a throw would have lost every import's picks and shown a red
  toast, for a whole season. Apps Script evidently TOLERATES the builder. Real defect is the
  narrower one: day rules all targeted the final matchup column. Plan text corrected.
  Lesson: check how long a suspected bug has survived before calling it a root cause.

Task 6: COMPLETE (commits 17f108e..c9f75dc, review APPROVED - no Critical)
  weeklySheet 1033 -> 59 lines (32 insertions / 1008 deletions). Reviewer proved completeness
  4 ways incl. method-name multiset: ZERO methods present in old and absent in new - the check
  that would have caught the earlier stranded setBorder.
  13 statements legitimately preserved. The zero-member guard is the important one: my brief
  wrongly said `if (!layout) return null` covers it; computeWeeklyLayout returns a DEGENERATE
  OBJECT (totalMembers 0, entryRowEnd < entryRowStart). Implementer kept the guard. Plan fixed.
  clearFormat rectangle carry-forward RESOLVED: adjustRows/adjustColumns resize to exactly the
  target and applyWeeklyFormatting has one caller, always right after writeWeeklyContent.
  Minor: ledger said 13 setNote, actual is 12.
Task 7: COMPLETE (commits 38a55c7..30a6cb5, 2 fix passes, review APPROVED)
  28 tests. Interlock honestly characterised: load-bearing checks are the INDEPENDENT sheet
  reads (getMaxRows, getMaxColumns, header row, NAMES start row, NAMES parent sheet, blank-row
  scan). Roster length+contents are tautologies from the live caller (layout.members derives
  from namesValues) - kept for the pure comparator's contract only. sheetExists branch is dead
  from the live caller. Plan corrected to say so.
  Fix 1: NAMES_{week} is spreadsheet-scoped and can point at a DIFFERENT sheet after a rename
    or duplication -> now guarded, logic placed in the pure comparator so it is testable.
  Fix 2: blank-row-scan test was CONFOUNDED - reviewer mutation-tested by deleting the block
    and the test still passed (the inert roster loop caught it instead). Since the roster loop
    cannot fire live, the blank-row scan is the SOLE live defense. Test rewritten to mirror the
    real derivation; isolation proven by re-deleting the block and watching it fail.
  Also: 3 reason codes gained the remedy text the other 5 had; 1 no-op duplicate test removed.
Task 8: COMPLETE (commits 3ff9afe..6089c5c, 1 fix pass, review APPROVED)
  reformatWeeklySheet: 26 lines, 3 return paths, zero banned calls, never throws.
  Fix: parameter-defaulting JSON.parse sat OUTSIDE the try/catch, so a corrupt document
  property threw a raw SyntaxError out of a function contracted never to throw - and the
  Task 9 panel loops it across ~18 weeks, so one corrupt property would abort the whole run.
  Reproduced before/after. The same unguarded pattern exists 75x in picks.gs as house style;
  deliberately NOT fixed elsewhere - only this function carries a never-throw contract.
  Manual canaries (paid checkbox + hand-entered spread survive a reformat) remain PENDING -
  they are the authoritative check and cannot run locally.
Task 9: COMPLETE (commits 4ca6ecb..bdf553f, 1 fix pass, review APPROVED)
  reformatPanel.html (232 lines) + getReformatPanelData / processReformatSubmission /
  launchReformatPanel. Reviewer independently re-derived HTML correctness, confirmed union
  semantics make no-sheet and no-form-data reachable, and matched all 8 reason codes to the
  LABEL map in both directions. Single notion of "ready": both paths call verifyWeeklyLayout.
  6 disclosed deviations from my brief, all improvements. One was a real bug in MY brief:
  !isNaN(n) passes Number('')===0, so a blank forms key would render a phantom WK 0 row.
  Fix pass: lifted parseDocProp to top level so the panel's two new entry points get the same
  actionable corrupt-property message Task 8 added; they had bare JSON.parse.
Task 10: COMPLETE (commit fb6f340) - menu item, gated on config.pickemsInclude, placed with
  the repair tools (Update Formulas / Outcomes Validation), before the rebuild tools.
  NO separate review dispatched - single verified line; deliberate proportionality call,
  covered by the mandatory final whole-branch review. Menu render is PENDING manual.
Task 11: COMPLETE (commits 56f7ec8..61067ee, 1 test addition + 1 fix pass, review APPROVED)
  Step 1 decision: ONE parameterized trio via SIMPLE_SHEET_SPECS, with the genuinely-different
  conditional-format rules isolated in an explicit 3-way branch rather than forced into data.
  Equivalence proven TWICE by independent recording fakes (implementer's + reviewer's own):
  4 sheets x 5 member counts x 10 grid scenarios x 3 week configs, all identical; differ
  mutation-proved 6/6. MNF unchanged (regression check).
  My brief's spec table was substantially WRONG - values came from dead code. Corrected:
  RANKS not RANK, PERCENTAGES not PERCENT, TOT weekFormat #0 / overallFormat ##, separate
  averages-row formats, RNK has NO averages row. Critically the named ranges are TOT-prefixed
  for RNK and PCT (TOT_OVERALL_RANK, TOT_WEEKLY_PCT...) - my rangePrefix sketch would have
  renamed them and silently broken every INDIRECT lookup on the season sheets.
  Fix pass: spec-wiring test was 4/7 TAUTOLOGY (layout.spec IS SIMPLE_SHEET_SPECS[key], same
  object ref) so it could not pin the named ranges it existed to pin. Now hardcoded literals,
  mutation-proven. THIRD instance this session of a test that asserted nothing.
  Accepted: Update Formulas no longer repairs TOT/RNK/PCT number formats (one owner per
  concern); Deploy/Refresh still does.
  Follow-up: TOTAL writes 'AVERAGES' to A2 which member names overwrite -> averages row
  unlabelled. Pre-existing, one-word fix, out of scope.
Task 12: COMPLETE (commit e85a035) - NOT a refactor; fixes live data loss.
  Gap confirmed against HEAD: awk over both function bodies (11424-11587 pre-change, brief's
  10925-11091 was stale) | grep -ci paid == 0. insertCheckboxes() sets every paid cell false
  on every member-expansion rebuild, and nothing scraped or restored it.
  3 edits: writeWeeklyContent now sets PAID_{week} named range (did not exist anywhere before)
  inside the EXISTING layout.paidCheckboxes guard, reusing the range insertCheckboxes() gets;
  getExistingWeeklySheetData scrapes it defensively (tiebreaker/comments pattern + Logger
  disclosure) into playerData[name].paid; remapAndRepopulateData restores by NAME via
  newMemberMap, writing only true.
  Brief's Step 4 sketch was wrong for the real code: it derives a paidCol and indexes by
  newRowIndex, but remapAndRepopulateData derives NO column positions - it addresses everything
  through named ranges and resolves position via newMemberMap. Followed the real pattern.
  Extra guard beyond brief: skip any target cell not reading exactly false. Covers a roster
  longer than the range, and a stale PAID_{week} left behind if weeklyPaidTracking is switched
  off, which would otherwise write TRUE into whatever cell now sits there.
  NO test added, deliberate: logic is 3 SpreadsheetApp calls, harness stubs them, such a test
  would pass with the fix reverted (would be the 4th nothing-asserting test this session).
  node --check ok, npm test 34/34 (unchanged), gate clean (3 entry points).
  PENDING manual BOTH halves - before (confirm 3 ticks vanish today) and after. CAVEAT the
  user needs: the FIRST rebuild after deploying is still lossy on each week sheet, since
  PAID_{week} does not exist until writeWeeklyContent creates it. Unrecoverable by design -
  guessing the old paid column from the new layout risks paying the wrong people.
Task 12: COMPLETE (commits e85a035..42376fa, review APPROVED - no Critical/Important)
  Paid status now scraped + restored BY NAME via newMemberMap, only `true` written back,
  degrades quietly when PAID_{week} is absent. My brief's Step 4 sketch was wrong (it derived
  a paidCol and indexed by row; the real function derives no column positions at all) -
  implementer followed the real code. Reviewer confirmed removed members skip cleanly and a
  mid-list insert cannot bleed into a neighbour.
  CAVEAT FOR USER: first member-adding import after deploy still clears that week's ticks,
  because PAID_{week} does not exist on pre-existing sheets. One re-tick per week sheet.
Task 13: COMPLETE - all automated gates green (34 tests, gate clean 3 entries, SYNTAX_OK);
  9 follow-ups recorded in the spec. Manual checklist remains for the user.

ALL 12 TASKS COMPLETE. Final whole-branch review next.

FINAL WHOLE-BRANCH REVIEW: READY WITH CAVEATS -> 1 merge-gating fix applied + 3 minors.
  I-1 (MINE, from spec §8): allFormulasUpdate wrote the paid formula using a layout
  recomputed from TODAY's roster (memberNames:null) - the exact hazard finding 1 solved for
  the reformat path, reintroduced in a function that WRITES. Reproduced: 4 of 5 roster
  scenarios land on a member's paid checkbox. Now routed through verifyWeeklyLayout, which
  derives members from NAMES_{week} and so resolves to the CORRECT cell, not merely refusing.
  Per-task review could not catch this: it lives between two tasks' briefs.
  Also: gate widened to 15 more value-destroying methods (uncheck/copyTo/sort/... - injection
  proven); Logger.log(teamData) removed (576 lines per full-season panel run); showRows added
  so re-enabling bonus/ATS un-hides the row (previously one-way, contradicting the premise).
  NOT fixed, triaged as don't-fix: duplicate name scanners, RegExp escaping, scanner
  destructuring gap, Task 2 coverage gaps, contests aliasing, TOTAL A2 label.

BRANCH COMPLETE: 55 commits, 34 tests, gate clean (3 entries), tree clean.
Manual verification remains with the user - it is the authoritative check.
