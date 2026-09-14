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
