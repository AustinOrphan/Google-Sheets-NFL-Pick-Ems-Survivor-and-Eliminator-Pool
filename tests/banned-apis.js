'use strict';

// ---------------------------------------------------------------------------
// LIMITATIONS - READ BEFORE TRUSTING A CLEAN RESULT
//
// This gate is a heuristic backstop, not a proof. It is regex-based static
// analysis of JavaScript/Apps Script source text, not a parser - and
// regex-based static analysis of JavaScript cannot be exhaustive. It can
// always be defeated by code shaped specifically to defeat it. In
// particular this gate CANNOT see:
//   - dynamic dispatch, e.g. obj[name]() or obj['set' + 'Value']()
//   - eval()/Function() construction of code at runtime
//   - a banned call reached only through a callback stored in a variable,
//     array, or object property rather than referenced by its own bare
//     name (e.g. `const fns = [smuggler]; fns[0](range);`)
//   - anything hidden behind a class of unparseable code this scanner does
//     not yet know to fail loudly on (see bodyOf()/ConciseArrowBodyError
//     below for the two classes it does know about)
//
// A clean run of this gate ("banned-api gate: clean") is evidence, not
// certainty. The authoritative check that applyWeeklyFormatting - and
// everything it transitively calls - never mutates sheet data is the
// manual canary checks in the plan's Task 8: a ticked paid checkbox and a
// hand-entered spread value must both survive a reformat. Do not treat a
// clean gate result alone as sufficient signoff.
// ---------------------------------------------------------------------------

const { load } = require('./harness.js');

// Every entry has a `kind`, which decides what "safe" means for it:
//
//   'formatting' - a sheet-mutating entry point (e.g. applyWeeklyFormatting).
//     BANNED write APIs may never appear anywhere in its transitive call
//     graph, and it MUST call clearFormat() itself (REQUIRED) - the whole
//     point of this entry shape is reformat-via-clearFormat-then-reapply,
//     never raw writes.
//
//   'pure' - a function that must never touch the Apps Script surface at
//     all (e.g. computeWeeklyLayout, which computes layout geometry as a
//     plain function of its arguments). PURE_BANNED bans the Apps Script
//     globals outright (SpreadsheetApp, PropertiesService, HtmlService,
//     DriveApp, UrlFetchApp, FormApp, ScriptApp), SpreadsheetApp-derived
//     calls, and the module-level adjustRows/adjustColumns/getMaxRows/
//     getMaxColumns helpers. clearFormat() is not required - a pure
//     function has no sheet to reset.
const ENTRIES = [
  { name: 'applyWeeklyFormatting', kind: 'formatting' },   // Task 11 appends applySimpleFormatting
  { name: 'computeWeeklyLayout',   kind: 'pure' },
];

const BANNED = [
  ['setValue',         /\.setValue\s*\(/],
  ['setValues',        /\.setValues\s*\(/],
  ['setFormula',       /\.setFormula\s*\(/],
  ['setFormulaR1C1',   /\.setFormulaR1C1\s*\(/],
  ['setFormulas',      /\.setFormulas\s*\(/],
  ['setFormulasR1C1',  /\.setFormulasR1C1\s*\(/],
  ['clear',            /\.clear\s*\(/],         // widened: also catches .clear({contentsOnly:true})
  ['clearContent',     /\.clearContent\s*\(/],  // Range.clearContent() - singular, real API
  ['clearContents',    /\.clearContents\s*\(/], // Sheet.clearContents() - plural, real API
  ['insertCheckboxes', /\.insertCheckboxes\s*\(/],
  ['adjustRows',       /\badjustRows\s*\(/],
  ['adjustColumns',    /\badjustColumns\s*\(/],
  ['setNamedRange',    /\.setNamedRange\s*\(/],
];

const REQUIRED = [['clearFormat', /\.clearFormat\s*\(/]];

// Banned surface for kind 'pure' - the whole Apps Script API, not just the
// write subset BANNED covers. A pure function isn't just forbidden from
// writing; it must never read or reference the sheet at all.
const PURE_BANNED = [
  ['SpreadsheetApp',    /\bSpreadsheetApp\b/],
  ['PropertiesService', /\bPropertiesService\b/],
  ['HtmlService',       /\bHtmlService\b/],
  ['DriveApp',          /\bDriveApp\b/],
  ['UrlFetchApp',       /\bUrlFetchApp\b/],
  ['FormApp',           /\bFormApp\b/],
  ['ScriptApp',         /\bScriptApp\b/],
  ['getRange',          /\.getRange\s*\(/],
  ['setValue',          /\.setValue\s*\(/],
  ['setNote',           /\.setNote\s*\(/],
  ['setNamedRange',     /\.setNamedRange\s*\(/],
  ['toast',             /\.toast\s*\(/],
  ['getUi',             /\.getUi\s*\(/],
  ['adjustRows',        /\badjustRows\s*\(/],
  ['adjustColumns',     /\badjustColumns\s*\(/],
  ['getMaxRows',        /\.getMaxRows\s*\(/],
  ['getMaxColumns',     /\.getMaxColumns\s*\(/],
];

function declaredFunctionNames(src) {
  const names = new Set();
  for (const re of [
    /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/gm,
  ]) {
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Comment/string/regex-aware brace matcher.
//
// The previous bodyOf() counted raw '{'/'}' characters. That breaks the
// instant a line comment contains an unbalanced brace, e.g. picks.gs:9827:
//   if (displayEmpty) { //|| forms[week].respondents == totalMembers) {
// The trailing "//" comment's stray '{' permanently offsets a naive
// counter, so bodyOf(src, 'weeklySheet') returned null even though
// weeklySheet is exactly the function this gate exists to police.
// picks.gs has ~14 lines like this - it is a recurring style here, not an
// edge case to shrug off.
//
// findMatchingBrace() walks the source as a tiny state machine so that
// brace counting only ever happens in "real code" position, never inside a
// // line comment, /* block comment */, '...' or "..." string, template
// literal text, or regex literal. Template literals are handled with a
// stack so `${...}` interpolation - which can itself contain braces, and
// can nest further template literals - unwinds correctly.
//
// isRegexContext() is a heuristic, not a parser: distinguishing a regex
// literal from a division operator is undecidable without full parsing, so
// it goes with the same lookback trick most hand-rolled JS tokenizers use -
// inspect the last significant token before '/':
//   - identifier/number/')'/']'  -> division (`a/2`, `f()/2`, `arr[0]/2`)
//   - keyword (return/typeof/instanceof/in/of/new/delete/void/throw/
//     case/yield/do/else), any other operator/punctuation, or
//     start-of-expression -> regex literal start
// This correctly classifies every literal actually present in picks.gs
// (verified separately - see task-1-report.md), including ones whose
// pattern contains braces, e.g. /[A-Z]{2,3}/ right after '(' or '='. Its
// known blind spot: a regex immediately following a block statement's
// closing '}' (e.g. `if (x) {} /re/.test(y)`) reads as division instead,
// which would then misparse the rest of the regex text as code. picks.gs
// contains no such construct (division always follows an operand, regex
// literals always follow an operator/keyword/opening bracket).
// ---------------------------------------------------------------------------

const REGEX_CONTEXT_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'yield', 'do', 'else',
]);

function isRegexContext(src, pos) {
  let j = pos - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true; // start of source: nothing precedes '/'
  const c = src[j];
  if (c === ')' || c === ']') return false; // f(...)/2, arr[0]/2 -> division
  if (/[A-Za-z0-9_$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
    const word = src.slice(k + 1, j + 1);
    return REGEX_CONTEXT_KEYWORDS.has(word); // keyword -> regex, identifier/number -> division
  }
  return true; // operator, punctuation, '(', '{', ',', '=', etc. -> regex
}

function skipRegexLiteral(src, i) {
  // src[i] === '/' and isRegexContext() already said this is a regex start.
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n') return i + 1; // unterminated - bail, treat '/' as itself
    if (c === '[') { inClass = true; j++; continue; }
    if (c === ']') { inClass = false; j++; continue; }
    if (c === '/' && !inClass) { j++; break; }
    j++;
  }
  while (j < src.length && /[a-zA-Z]/.test(src[j])) j++; // flags (g, i, gm, ...)
  return j;
}

// Scans forward from `start` (src[start] === '{') and returns the index one
// past the matching '}', treating line/block comments, quoted strings,
// template literals (with nested `${...}` interpolation), and regex
// literals as opaque - their contents never affect brace depth. Returns -1
// if the braces never balance (truncated/invalid input).
//
// opaqueSpanEnd() below recognises exactly which spans are "not real code"
// (line comment, block comment, quoted string, regex literal) and is
// shared verbatim with stripNonCode() further down - the fix for the
// bare-word callee scan (and banned-API detection) matching inside a
// comment or string. picks.gs:10052 is a COMMENT that happens to contain
// the word "weeklySheet" ("Fixed-column header notes. weeklySheet still
// applies these itself..."); before stripNonCode() existed that single
// word pulled all 1,033 lines of weeklySheet into computeWeeklyLayout's
// transitive scan. findMatchingBrace() and stripNonCode() both drive the
// same opaque-span detection and the same template-literal nesting stack,
// so they can never disagree about what counts as real code.

// Given src[i] is NOT inside template-literal text (i.e. we're at "code"
// position - possibly nested inside a `${...}` interpolation), returns the
// index one past the line comment / block comment / quoted string / regex
// literal starting at i, or -1 if src[i] does not start one of those.
function opaqueSpanEnd(src, i) {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? src.length : nl; // stop before '\n' - caller sees it as an ordinary char
  }
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  if (c === '"' || c === "'") {
    const quote = c;
    let j = i + 1;
    while (j < src.length && src[j] !== quote && src[j] !== '\n') {
      j += src[j] === '\\' ? 2 : 1;
    }
    return j + 1; // consume closing quote (or step past newline/EOF on unterminated string)
  }
  if (c === '/' && isRegexContext(src, i)) return skipRegexLiteral(src, i);
  return -1;
}

function findMatchingBrace(src, start) {
  const stack = ['{'];
  let i = start + 1;
  while (i < src.length) {
    const top = stack[stack.length - 1];

    if (top === '`') {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push('{'); i += 2; continue; }
      i++;
      continue;
    }

    const span = opaqueSpanEnd(src, i);
    if (span !== -1) { i = span; continue; }

    const c = src[i];
    if (c === '`') { stack.push('`'); i++; continue; }
    if (c === '{') { stack.push('{'); i++; continue; }
    if (c === '}') {
      stack.pop();
      i++;
      if (stack.length === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}

// Returns a copy of `src` with every line comment, block comment, quoted
// string, template-literal text chunk, and regex literal blanked out
// (replaced with spaces; newlines are kept, so line counts are
// unaffected). Real code - identifiers, operators, template-literal
// `${...}` interpolation, backticks, braces - passes through unchanged.
//
// Callers run BANNED/REQUIRED/callee-bare-word regex tests against
// stripNonCode(body), never against the raw body text, so a word that
// merely appears in a comment or string can no longer be mistaken for a
// real reference. This does NOT narrow the bare-word matching itself
// (still no trailing '(' required, so `.forEach(callbackByReference)`
// stays reachable) - it only removes text that was never real code in the
// first place.
//
// Deliberately reuses findMatchingBrace()'s exact state machine
// (opaqueSpanEnd() plus the same backtick/`${`-nesting stack) rather than
// re-implementing comment/string detection a second time - see the block
// comment above findMatchingBrace() for why the two must never diverge.
function stripNonCode(src) {
  const dst = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (dst[k] !== '\n') dst[k] = ' ';
  };

  const stack = [];
  let i = 0;
  while (i < src.length) {
    const top = stack[stack.length - 1];

    if (top === '`') {
      const c = src[i];
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }                             // backtick stays as code
      if (c === '$' && src[i + 1] === '{') { stack.push('{'); i += 2; continue; } // '${' stays as code
      blank(i, i + 1); i++;                                                       // template text - opaque
      continue;
    }

    const span = opaqueSpanEnd(src, i);
    if (span !== -1) { blank(i, span); i = span; continue; }

    const c = src[i];
    if (c === '`') { stack.push('`'); i++; continue; }
    if (c === '{') { stack.push('{'); i++; continue; }
    if (c === '}') { stack.pop(); i++; continue; }
    i++;
  }
  return dst.join('');
}

// Thrown by bodyOf() when a declaration is a concise-body arrow function
// (`=> expr`, no `{`) - see the comment on isConciseArrowBody() for why this
// must be a loud failure rather than an attempted parse or a silent skip.
class ConciseArrowBodyError extends Error {
  constructor(name) {
    super(
      `${name}: declared as a concise-body arrow ("=> expr" with no "{") - ` +
      `this gate's regex-based scanner cannot safely locate the end of an ` +
      `expression body (there is no brace to balance), so it cannot be ` +
      `scanned for banned calls. Rewrite it with a block body ` +
      `("=> { ... }") so the gate can read it.`
    );
    this.fnName = name;
  }
}

// True iff, starting at `pos` (the position immediately after the '=' of a
// top-level `const/let/var NAME = ...` declaration matched by bodyOf()'s own
// regex), the right-hand side is an arrow function whose body is a bare
// expression rather than a block. False for everything else - a function
// expression (`= function(...) {...}`), a non-function value, a reference to
// another name, or a block-bodied arrow (`= (...) => {...}`) - all of which
// the existing '{'-to-matching-'}' walk in bodyOf() already handles
// correctly and must keep handling unchanged.
//
// Why this needs its own tiny scan instead of reusing findMatchingBrace():
// a concise arrow's body has no '{' at all, so "find the first '{' after the
// declaration" (bodyOf()'s normal strategy) walks straight past the
// declaration into whatever unrelated '{' appears later in the file and
// returns that as the "body" - silently scanning the wrong code. This
// function only has to answer "is there a '{' immediately after this
// specific '=>'?", which needs nothing more than matching the arrow's own
// parameter list.
function isConciseArrowBody(src, pos) {
  let i = pos;
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };

  skipWs();
  if (/^function(?![\w$])/.test(src.slice(i))) return false; // function expr, not an arrow
  if (/^async(?![\w$])/.test(src.slice(i))) {
    i += 'async'.length;
    skipWs();
    if (/^function(?![\w$])/.test(src.slice(i))) return false; // async function expr
  }

  if (src[i] === '(') {
    // Parenthesized parameter list - track paren depth only (default-value
    // braces, if any, don't affect where this list ends).
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
  } else if (/[A-Za-z_$]/.test(src[i] || '')) {
    // Bare single-identifier parameter, e.g. `x => x + 1`.
    while (i < src.length && /[\w$]/.test(src[i])) i++;
  } else {
    return false; // RHS doesn't start like an arrow's parameter list at all
  }

  skipWs();
  if (src[i] !== '=' || src[i + 1] !== '>') return false; // not an arrow
  i += 2;
  skipWs();
  return src[i] !== '{'; // concise (expression) body iff no block follows
}

function bodyOf(src, name) {
  const re = new RegExp(
    `^(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`, 'm');
  const m = re.exec(src);
  if (!m) return null;

  // Only the `(const|let|var) NAME =` alternative can be an arrow - the
  // `function NAME(` alternative always has a real block body. Check for a
  // concise arrow *before* doing the normal brace walk, so Gap A (a concise
  // arrow's body being silently mis-scanned as unrelated later code) fails
  // loudly instead.
  if (/=\s*$/.test(m[0]) && isConciseArrowBody(src, m.index + m[0].length)) {
    throw new ConciseArrowBodyError(name);
  }

  const start = src.indexOf('{', m.index);
  if (start === -1) return null;
  const end = findMatchingBrace(src, start);
  if (end === -1) return null;
  return src.slice(start, end);
}

const src = load().__source;
const declared = declaredFunctionNames(src);
const problems = [];

for (const { name: entry, kind } of ENTRIES) {
  const banned = kind === 'pure' ? PURE_BANNED : BANNED;

  let own;
  try {
    own = bodyOf(src, entry);
  } catch (e) {
    if (!(e instanceof ConciseArrowBodyError)) throw e;
    problems.push(e.message);
    continue;
  }
  if (own === null) { problems.push(`${entry}: not found in picks.gs`); continue; }

  if (kind === 'formatting') {
    const ownCode = stripNonCode(own);
    for (const [label, re] of REQUIRED) {
      if (!re.test(ownCode)) problems.push(`${entry}: MISSING required ${label}()`);
    }
  }

  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const fname = queue.shift();
    let body;
    try {
      body = bodyOf(src, fname);
    } catch (e) {
      if (!(e instanceof ConciseArrowBodyError)) throw e;
      // Same loud-failure treatment as a null body (below): an unparseable
      // callee could hide any banned call, so it must never be skipped.
      problems.push(`${entry} -> ${e.message}`);
      continue;
    }
    if (body === null) {
      // A function reachable from the entry point that this scanner cannot
      // parse must fail the gate loudly, not be silently skipped - an
      // unparseable function could hide any banned call. A gate that
      // exits 0 while quietly ignoring code it couldn't read is worse
      // than no gate at all.
      problems.push(`${entry} -> ${fname}: could not parse function body (parse failure - not scanned, treated as unsafe)`);
      continue;
    }
    // Comments/strings/regex literals are stripped BEFORE either scan
    // below runs, so a word that only ever appears in prose (e.g.
    // picks.gs:10052's "weeklySheet still applies these itself..." note
    // inside computeWeeklyLayout) can no longer masquerade as a real
    // banned call or a real callee reference. `code`, not `body`, is what
    // both scans below test against.
    const code = stripNonCode(body);

    for (const [label, re] of banned) {
      if (re.test(code)) problems.push(`${entry} -> ${fname}: BANNED ${label}()`);
    }
    for (const name of declared) {
      // Bare-word match, deliberately NOT requiring a following '(' - a
      // callee passed by reference (`.forEach(mutateViaCallback)`,
      // `.map(Number)`) is exactly as reachable as one that's called
      // directly, and requiring '(' made the old regex blind to it (Gap
      // B). This is intentionally over-approximate across REAL code:
      // matching a bare mention anywhere in the actual call graph, not
      // just a direct call, only causes the gate to scan *more* code,
      // never less - the unsafe direction is a false negative, not a
      // false positive. stripNonCode() (above) is what keeps this
      // over-approximation from also firing on comments/strings, which
      // are never real references and were never meant to be in scope.
      //
      // `seen` (not `code`) is what stops a function from re-enqueueing
      // itself: `fname` is always added to `seen` before its body is ever
      // scanned (either as the seed entry, or at the moment it was
      // discovered as a callee below), so a bare mention of fname's own
      // name inside its own body - self-recursion, a self-referential
      // comment, whatever - is skipped by `!seen.has(name)` regardless of
      // why it appears.
      if (!seen.has(name) && new RegExp(`\\b${name}\\b`).test(code)) {
        seen.add(name); queue.push(name);
      }
    }
  }
}

if (problems.length) {
  console.error('BANNED-API GATE FAILED');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`banned-api gate: clean (${ENTRIES.length} entry point(s))`);
