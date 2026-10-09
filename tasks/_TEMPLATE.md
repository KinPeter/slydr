# T000 — <Short imperative title>

**Epic:** <E# from docs/specification.md §15>
**Spec sections:** <§x.y, FR-nn, NFR-n>
**Depends on:** <T00x, T00y | none>
**Estimated size:** <S | M | L>

---

## 1. Context

Two to five sentences. What part of Slydr this ticket builds, and why it exists.
Written so an implementation agent who has read nothing else understands the
purpose. Do not assume the reader has seen any other ticket.

## 2. Scope

### In scope
- Explicit, enumerated list of what to build.

### Out of scope
- Things a reader might assume belong here but which another ticket owns.
  Name the owning ticket where known (e.g. "thumbnail caching — T016").

## 3. Prerequisites and assumed state

What already exists in the repo when this ticket starts: files, exported
symbols with their signatures, scripts, dependencies. Quote the exact
signatures/types the implementer will consume so they need not open other
tickets. If the ticket starts from an empty repo, say so.

## 4. Implementation detail

The substance of the ticket. Include:

- Exact file paths to create or modify.
- Full type/interface/function signatures, verbatim from the specification
  where the specification states them.
- Algorithms as numbered steps when order matters.
- Exact literal values: constants, limits, defaults, header names, HTTP status
  codes, error codes, CSS values, timings.
- Code snippets for anything non-obvious.
- Cross-platform notes (win32 / darwin / linux) where behaviour differs.

## 5. Acceptance criteria

Checklist. Each item independently verifiable by running something or reading
a specific file. No vague items ("works correctly").

- [ ] ...

## 6. Tests to write

Named test cases with the file they live in and the exact behaviour asserted.
Reference the quality strategy in docs/specification.md §12.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] <ticket-specific items>
- [ ] README updated if setup or user-visible behaviour changed.

## 8. Notes and gotchas

Known traps, platform quirks, performance constraints, and anything in
docs/specification.md §16 (assumptions / open items) relevant to this ticket.
