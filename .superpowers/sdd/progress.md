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

  *** MAJOR HYPOTHESIS for Task 6 manual check ***
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
