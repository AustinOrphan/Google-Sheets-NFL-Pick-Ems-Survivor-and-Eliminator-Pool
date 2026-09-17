# Reapply Formatting — Manual Verification

**Branch:** `feat/reapply-formatting` · **Version:** 1.2.5 · **Written:** 2026-09-17

The procedure for verifying the Reapply Formatting feature in a real spreadsheet.
Run it once before the branch is considered done, and again after any change to
`applyWeeklyFormatting`, `verifyWeeklyLayout`, `compareWeeklyLayout`, or
`reformatPanel.html`.

---

## Why this can't be automated

The Node harness loads `picks.gs` behind chainable Proxy stubs. Every
`SpreadsheetApp` call is swallowed, so the suite can prove the *shape* of what
the code does — `applyWeeklyFormatting` was observed making 352 layout calls
across 25 methods with zero mutating ones — but it cannot prove what Sheets
actually does in response. These four questions are only answerable in a live
spreadsheet:

1. What `clearFormat()` really removes. It leaves notes, sheet-level conditional
   format rules, and data validation intact; the formatting path depends on that.
2. Whether re-asserting a checkbox with `setDataValidation(...requireCheckbox())`
   preserves the cell's existing `TRUE`/`FALSE`. (`insertCheckboxes()` would
   reset every cell to false — which is why the formatting path never calls it.)
3. Whether `breakApart()` → `mergeAcross()` is stable across repeated runs.
4. Whether the interlock's header comparison matches the strings a real sheet
   returns, once `normalizeHeader` has run over them.

---

## Before you start

**Work on a copy.** `File → Make a copy`. Reformatting writes to the sheet, and
while the interlock refuses to run on a drifted layout, it is not a guarantee.

**Then confirm the copy carried its data.** Apps Script document properties hold
`configuration`, `forms` and `members`, and the panel builds its week list from
`forms` plus any sheet named `WK<number>`. If document properties did not travel
with the copy, the panel will list every week as `🚫 no form data` and nothing
below can be tested. If that happens, re-run Configuration from the Picks menu in
the copy, or test against the live spreadsheet with correspondingly more care.

---

## Deploy

Two files, not one. `reformatPanel.html` is new on this branch and will not exist
in the Apps Script project yet.

- [ ] `Extensions → Apps Script`
- [ ] Replace the contents of `picks.gs` with the branch version
- [ ] `File → + → HTML`, name it exactly **`reformatPanel`** (Apps Script appends
      `.html`), paste the contents of `reformatPanel.html`
- [ ] Save, then reload the spreadsheet so `onOpen` rebuilds the menu

The menu entry is **Picks → 🧰 Utilities → 🎨 Reapply Formatting**. It only
appears when `config.pickemsInclude` is true.

---

## Check 0 — The panel loads and reports honestly

- [ ] Open the panel.

**Pass:** one row per weekly sheet. Ready weeks show `✅ ready` with the checkbox
enabled and pre-ticked. Blocked weeks are greyed, checkbox disabled, showing one
of `⚠️ schedule drift`, `🚫 no form data`, `🚫 no sheet`,
`⚠️ row count mismatch`, `⚠️ column count mismatch`,
`⚠️ member list mismatch`, `⚠️ could not check` — plus a remedy line beneath.

**Fail:** a raw reason code with no emoji means the label map has drifted from
the codes `compareWeeklyLayout` returns. A blank panel means `reformatPanel.html`
is missing or misnamed.

---

## Check 1 — Data preservation *(the one that matters most)*

This is the only real test of data safety. Everything else is cosmetic by
comparison.

On one ready weekly sheet, **before** reformatting:

- [ ] Tick exactly **3 paid checkboxes**, in three different member rows. Write
      down which members.
- [ ] Type a distinctive spread — **`-99`** — into a spread cell. Note the cell.
- [ ] Note two members' existing picks, by cell and value.
- [ ] Note the tiebreaker value for one member, if tiebreakers are on.

Then reformat that single week.

**Pass:** all four survive exactly. The 3 checkboxes are still ticked, `-99` is
still there, the picks are unchanged, the tiebreaker is unchanged.

**Fail:** any paid checkbox reverting to unticked means the formatting path
reached `insertCheckboxes()`. Any cleared value means a formatting call is
mutating data — stop and report it; do not continue the sequence.

---

## Check 2 — Repair actually repairs

On the same sheet, break four different kinds of formatting:

- [ ] Fill a block of cells bright red
- [ ] Drag a column much wider
- [ ] Unmerge a merged header (the Chances header, or the spread/bonus label)
- [ ] Clear a border somewhere in the grid

Reformat that week.

**Pass:** all four restored to normal.

**Fail:** anything left broken means that property is not in the layout
inventory — note precisely which one.

---

## Check 3 — Idempotency

- [ ] Select the whole sheet (click the corner box), open
      `Format → Conditional formatting`, and record the **number of rules**.
- [ ] Reformat the same week twice in a row.
- [ ] Select the whole sheet again, re-open the sidebar, compare the rule count.

**Pass:** identical rule count, and no merged header has come apart.

**Fail:** a growing rule count means rules are being appended rather than
replaced. (The code calls `setConditionalFormatRules(formatRules)`, which
replaces wholesale, so this should hold — Check 3 exists to confirm that in the
live environment.)

---

## Check 4 — The interlock refuses on drift

- [ ] Edit a team abbreviation in the matchup header row of a ready week.
- [ ] Reopen the panel.

**Pass:** that week is now greyed with `⚠️ schedule drift` and a detail line of
the form:

> `Week N's matchups no longer match the schedule (column X: sheet has "...", schedule has "..."). Use Deploy / Refresh to rebuild instead.`

- [ ] Confirm the week's checkbox is disabled and **no formatting was applied**.
- [ ] Undo the edit (`Ctrl/Cmd+Z`), reopen the panel, confirm it reads `✅ ready`
      again, and reformat successfully.

**Fail:** if a drifted week still reformats, the interlock is not gating — this
is the check that proves the safety mechanism actually blocks rather than merely
reports.

---

## Check 5 — Partial failure isolation

The panel is a **modal** dialog, so the sheet cannot be edited while it is open —
which means a week cannot realistically go from ready to drifted between the
panel's snapshot and submission through the UI. Test this from the Apps Script
editor instead, where the mixed batch can be constructed directly.

- [ ] Leave one week drifted (from Check 4) and note two healthy week numbers.
- [ ] In the Apps Script editor add a temporary function, substituting your own
      week numbers — the drifted one plus two healthy:

```js
function tmpPartialFailure() {
  Logger.log(JSON.stringify(processReformatSubmission([3, 4, 5]), null, 2));
}
```

- [ ] Run it and read the log.

**Pass:** the returned `results` array has one entry per week. The healthy weeks
show `"ok": true` with `"reason": "ready"`, the drifted week shows `"ok": false`
with `"reason": "drift"` and its detail. The healthy sheets are genuinely
reformatted. The `message` reads `Reformatted 2; skipped 1 (WK5).`

**Fail:** the run throwing, or one bad week preventing the others from being
reformatted.

- [ ] Delete the temporary function afterwards.

Also confirm the normal path's messaging: with no failures the toast reads
`Reformatted N weeks.` under the title `🎨 REAPPLY FORMATTING`.

---

## Check 6 — Tab colours

`processReformatSubmission` repaints every `WK` tab once after the loop, from the
highest successfully reformatted week down to 1.

- [ ] Note the tab colours before a run, and after.

**Pass:** colours follow the usual weekly gradient and no tab is left an
unexpected colour.

---

## Record

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 0 | Panel loads | | |
| 1 | Data preservation | | |
| 2 | Repair repairs | | |
| 3 | Idempotency | | |
| 4 | Interlock refuses drift | | |
| 5 | Partial failure isolation | | |
| 6 | Tab colours | | |

---

## When something fails

`Extensions → Apps Script → Executions` carries the log lines. The feature logs:

- `🎨 Week N formatting reapplied.` — success
- `⛔ Week N not reformatted [reason]: detail` — refused by the interlock
- `⛔ Week N reformat failed: message` — threw inside `applyWeeklyFormatting`
- `🎨 Reformatted N; skipped M (...)` — the run summary

A refusal is the interlock working. A *failure* is a bug — capture the message
and the week number.

Rollback is discarding the copy.

---

## Out of scope

- **Simple sheets (TOT / RNK / PCT).** They were refactored into
  `computeSimpleLayout` / `writeSimpleContent` / `applySimpleFormatting`, but the
  panel is weekly-only, so there is no user-facing path to reformat them yet.
- **Stale notes.** All 12 note sites sit on header rows gated by the same config
  toggles the interlock compares. If a toggle changed, the reformat is refused,
  so a stale note cannot arise on a run that proceeds. Nothing to test.
