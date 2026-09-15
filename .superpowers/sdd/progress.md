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
