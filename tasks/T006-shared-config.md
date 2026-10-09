# T006 — Implement SlideshowConfig defaults and parseConfig validator

**Epic:** E2 — Shared domain package
**Spec sections:** §4.4, §6.2, §8.2
**Depends on:** T004 (and, through it, T001 and T002)
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based slide-show application with three screens: a file explorer, a slide-show configuration screen, and the player. The configuration screen offers seven options — slide duration, shuffle, loop, animations, fill-empty-space, start-fullscreen, and include-subfolders — and every change is persisted immediately to `localStorage` under the key `slydr.config`.

`localStorage` is untrusted input. The stored value can be stale (written by an older version of the app with different fields), hand-edited by a curious user through the browser devtools, truncated, or replaced with arbitrary JSON. The app must never crash or show an error because of it; specification §6.2 is explicit that "a corrupt or stale value must degrade to the default silently — never throw, never show an error".

This ticket creates `shared/src/config.ts`: the `SlideshowConfig` interface, the `DEFAULT_CONFIG` object, and `parseConfig(input: unknown): SlideshowConfig` — the total function that turns anything at all into a valid configuration. It lives in `@slydr/shared` rather than in the client because the configuration type is part of the shared domain model (specification §4.4) and because a pure, dependency-free validator is far easier to test exhaustively in a node environment than inside a React component.

## 2. Scope

### In scope

- Create `shared/src/config.ts` exporting:
  - `SlideshowConfig` — the interface, verbatim from specification §4.4.
  - `DEFAULT_CONFIG` — the defaults object, verbatim from specification §4.4.
  - `MIN_DURATION_SECONDS` and `MAX_DURATION_SECONDS` — the `1` and `30` bounds, named so the configuration screen's slider can use them instead of re-typing the numbers.
  - `parseConfig(input: unknown): SlideshowConfig` — a total function that never throws and always returns a fresh, fully populated, valid object.
- Append `export * from './config.js';` to `shared/src/index.ts`.
- An exhaustive Vitest unit suite driven by the adversarial-input table in section 4.6.

### Out of scope

- The `localStorage` read/write layer itself: the `slydr.schemaVersion` check, the 250 ms debounce, the `try`/`catch` wrapper that keeps the app working when storage is disabled, and the other persisted keys (`slydr.theme`, `slydr.explorer.viewMode`, `slydr.explorer.showHidden`, `slydr.explorer.lastPath`). Those belong to the client persistence ticket (specification §6.2). This ticket provides the parser that layer calls; it must not reference `localStorage`, `window`, or any browser global.
- The configuration screen's UI: the slider, the six checkboxes, the live "5 s" readout, the "Reset to defaults" link, the image-count fetch and the zero-image disabled state (specification §8). Those consume `DEFAULT_CONFIG` and `parseConfig`.
- Mapping `includeSubfolders` onto the `recursive` query parameter of `GET /api/fs/images`. That is the configuration screen's job.
- Any JSON serialisation or schema-version migration. `parseConfig` takes an already-parsed `unknown`, not a string.
- Runtime validation libraries. `@slydr/shared` has no runtime dependencies (specification §2.1); see section 8.

## 3. Prerequisites and assumed state

### From T001 — npm workspaces monorepo

- Root `package.json`: `"private": true`, `"type": "module"`, workspaces `["shared", "server", "client"]`, `engines.node >= 22`.
- Root `tsconfig.base.json` with `"strict": true`, extended by `shared/tsconfig.json`.
- `shared/package.json` named `@slydr/shared`, `"type": "module"`, with no runtime dependencies.
- Root scripts: `npm run typecheck`, `npm run build`.

### From T002 — lint, format and test tooling

- ESLint 9 flat config at `eslint.config.js` covering `shared/**/*.ts`, run by `npm run lint`.
- Prettier at the root, run by `npm run format`.
- Vitest configured to run `shared/test/**/*.test.ts` in the **node** environment, run by `npm test`. Tests live in `shared/test/` (not beside the source) and import `describe`, `it`, `expect` from `'vitest'`.
- `shared/tsconfig.json` has `lib: ["ES2023"]` and `types: []`, so DOM/Node-only globals such as `structuredClone` are not typed in tests; deep-clone with `JSON.parse(JSON.stringify(x))` (the inputs are JSON-safe) or a small local helper.

### From T004 — the shared API contract types

`shared/src/types.ts` exists and exports the API contract types and limit constants (`FsEntry`, `ListResponse`, `MAX_ENTRIES`, and so on). This ticket does **not** need any of them; `config.ts` is self-contained and should import nothing.

`shared/src/index.ts` exists and currently contains:

```ts
export * from './types.js';
```

It may also already contain `export * from './images.js';` if T005 has landed. Append this ticket's line rather than replacing the file.

## 4. Implementation detail

Create `shared/src/config.ts`. The module is pure: no imports, no I/O, no globals.

### 4.1 The interface and defaults (verbatim, specification §4.4)

```ts
export interface SlideshowConfig {
  durationSeconds: number;    // integer 1..30
  shuffle: boolean;
  loop: boolean;
  animations: boolean;
  fillEmptySpace: boolean;
  startFullScreen: boolean;
  includeSubfolders: boolean; // D1
}

export const DEFAULT_CONFIG: SlideshowConfig = {
  durationSeconds: 5,
  shuffle: true,
  loop: true,
  animations: true,
  fillEmptySpace: true,
  startFullScreen: true,
  includeSubfolders: false,
};
```

Copy both declarations exactly, comments included. Six of the seven options default to the "on" state the product owner asked for; `includeSubfolders` is the seventh option added by resolved decision D1 and defaults to **off**, meaning the slide show is non-recursive unless the user opts in.

Keep `DEFAULT_CONFIG` typed as `SlideshowConfig`, as the specification writes it — not `as const`. The configuration screen needs to assign to a copy of it, and widened `number`/`boolean` field types are what make that natural.

> **Decision (not specified).** Do not wrap `DEFAULT_CONFIG` in `Object.freeze`. The specification states the declaration verbatim and the protection is achieved differently and more usefully: `parseConfig` always returns a **fresh** object and never a reference to `DEFAULT_CONFIG`, so no caller can mutate the defaults by accident through a parsed result. The "Reset to defaults" action in specification §8.4 must likewise copy (`parseConfig(undefined)` or `{ ...DEFAULT_CONFIG }`) rather than assign the shared object.

### 4.2 The duration bounds

```ts
/** Inclusive lower bound for `durationSeconds` — specification §4.4, §8.2. */
export const MIN_DURATION_SECONDS = 1;

/** Inclusive upper bound for `durationSeconds` — specification §4.4, §8.2. */
export const MAX_DURATION_SECONDS = 30;
```

The configuration screen's slider (specification §8.2: "1–30 s, step 1, default 5") must use these constants for its `min` and `max` attributes rather than literals, so the slider and the validator can never disagree.

### 4.3 The central decision: strict typing, no coercion from other types

Specification §4.4 says `parseConfig` "clamps `durationSeconds` to `1..30` and rounds it to an integer, coerces each boolean, and substitutes the default for any missing or invalid field. It never throws."

> **Decision (not specified).** "Coerces each boolean" is read as *"produces a boolean for each of the six boolean fields"*, not as *"applies JavaScript truthiness to whatever value is present"*. Concretely: **a value of the wrong type is invalid and is replaced by that field's default. There is no cross-type coercion anywhere in `parseConfig`.**
>
> - `durationSeconds` is accepted only when `typeof value === 'number'` and `Number.isFinite(value)`. The string `'7'` is **rejected** and becomes the default `5`.
> - Each boolean field is accepted only when `typeof value === 'boolean'`. The string `'false'`, the string `'true'`, `0`, `1`, `null` and `''` are all **rejected** and become that field's default.
>
> Rationale, since this is the ticket's one real judgement call:
> 1. The only legitimate producer of `slydr.config` is Slydr's own writer, which serialises a `SlideshowConfig` with `JSON.stringify`. A number therefore round-trips as a number and a boolean as a boolean. A string where a boolean belongs does not mean "the user meant true"; it means the value is corrupt, and the correct response to corrupt input is the default.
> 2. Truthiness coercion is actively dangerous for this data. `Boolean('false')` is `true`, so a hand-edited `"shuffle": "false"` would silently turn shuffling **on** — the exact opposite of the user's evident intent. Falling back to the documented default is both safer and easier to explain.
> 3. `Number('')` is `0` and `Number('abc')` is `NaN`, so numeric coercion needs its own thicket of follow-up checks and still produces surprising results. Rejecting non-numbers outright removes the thicket.
> 4. One rule — "wrong type means default" — applies uniformly to all seven fields, which makes the function auditable at a glance and the test table trivial to extend.
>
> The visible consequence to accept: `parseConfig({ durationSeconds: '5' })` returns `durationSeconds: 5`, which happens to equal the default. That is a coincidence of the default value, not coercion. The test suite must therefore also assert `parseConfig({ durationSeconds: '7' }).durationSeconds === 5`, which distinguishes rejection from coercion unambiguously. See section 6.

### 4.4 Implementation

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key)
    ? source[key]
    : undefined;
}

function parseDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.durationSeconds;
  }
  const rounded = Math.round(value);
  if (rounded < MIN_DURATION_SECONDS) return MIN_DURATION_SECONDS;
  if (rounded > MAX_DURATION_SECONDS) return MAX_DURATION_SECONDS;
  return rounded;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Turn anything at all into a valid `SlideshowConfig`.
 *
 * Never throws, never mutates `input`, and always returns a fresh object with
 * exactly the seven `SlideshowConfig` keys. This is the defence against a
 * hand-edited or stale `localStorage` value (specification §6.2): a corrupt
 * value degrades silently to the defaults, field by field.
 */
export function parseConfig(input: unknown): SlideshowConfig {
  if (!isRecord(input)) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    durationSeconds: parseDuration(own(input, 'durationSeconds')),
    shuffle: parseBoolean(own(input, 'shuffle'), DEFAULT_CONFIG.shuffle),
    loop: parseBoolean(own(input, 'loop'), DEFAULT_CONFIG.loop),
    animations: parseBoolean(own(input, 'animations'), DEFAULT_CONFIG.animations),
    fillEmptySpace: parseBoolean(
      own(input, 'fillEmptySpace'),
      DEFAULT_CONFIG.fillEmptySpace,
    ),
    startFullScreen: parseBoolean(
      own(input, 'startFullScreen'),
      DEFAULT_CONFIG.startFullScreen,
    ),
    includeSubfolders: parseBoolean(
      own(input, 'includeSubfolders'),
      DEFAULT_CONFIG.includeSubfolders,
    ),
  };
}
```

Five properties of this implementation are load-bearing and must survive any refactor:

1. **Per-field recovery, not all-or-nothing.** A record with one bad field keeps its six good ones. Specification §6.2's fallback column says `DEFAULT_CONFIG`, "**per field**". Only a non-record input (section 4.5) discards everything, because there is nothing to salvage.
2. **The output is constructed as a literal**, never by spreading `input`. Unknown keys therefore cannot survive into the result, and the result always has exactly seven own keys in interface order.
3. **Reads go through `own()`**, which consults `Object.prototype.hasOwnProperty`. Inherited properties are invisible to the parser, so an object whose prototype has been tampered with — or a globally polluted `Object.prototype` — cannot inject values. See section 4.6.
4. **Round, then clamp.** `Math.round` first guarantees an integer, and the two comparisons then guarantee the range, so the result is always an integer in `[1, 30]`. Doing it the other way round also works for these bounds, but round-then-clamp is the order that makes the guarantee obvious. Note that `Math.round` is half-up: `7.5` becomes `8`, and `-0.5` becomes `-0`, which the lower clamp then turns into `1`.
5. **`input` is not mutated.** No field is written back, no `delete`, no sorting in place. Callers may pass a React state object directly.

### 4.5 Non-record inputs

`parseConfig` returns `{ ...DEFAULT_CONFIG }` for anything that is not a plain object. `isRecord` rejects, in order:

- primitives, via `typeof value === 'object'` — this covers `undefined`, a string, a number, a boolean, a bigint and a symbol;
- `null`, which `typeof` reports as `'object'`, via the explicit `value !== null` check;
- arrays, via `Array.isArray`. An array is technically an object with indexable keys, and `['a']['durationSeconds']` is `undefined`, so an array would already degrade to all-defaults without the check. It is checked explicitly anyway, so the intent is visible and the behaviour is pinned by a test rather than emergent.

> **Decision (not specified).** Functions, class instances, `Map`, `Date` and other exotic objects are treated as records: they pass `isRecord` (except functions, whose `typeof` is `'function'`, and which therefore fall through to all-defaults), their own properties are inspected, and in practice none of the seven keys will be present, so the result is all-defaults. No special-casing is warranted — the per-field logic already handles them correctly.

### 4.6 Required behaviour for adversarial inputs

Every row below is a required behaviour, and section 6 names the corresponding test case. "defaults" means a fresh object deep-equal to `DEFAULT_CONFIG`.

| Input | Result | Why |
|---|---|---|
| `undefined` | defaults | No stored value; the normal first-run path. |
| `null` | defaults | `typeof null === 'object'`, caught by the explicit null check. |
| `'string'` | defaults | Primitive, not a record. |
| `42` | defaults | Primitive, not a record. |
| `true` | defaults | Primitive, not a record. |
| `[]` | defaults | Array rejected explicitly. |
| `[1, 2, 3]` | defaults | Array rejected explicitly. |
| `() => {}` | defaults | `typeof` is `'function'`, not `'object'`. |
| `{}` | defaults | A record with no recognised keys. |
| `{ durationSeconds: 0 }` | `durationSeconds: 1`, rest default | Clamped to `MIN_DURATION_SECONDS`. |
| `{ durationSeconds: -5 }` | `durationSeconds: 1` | Clamped low. |
| `{ durationSeconds: 31 }` | `durationSeconds: 30` | Clamped to `MAX_DURATION_SECONDS`. |
| `{ durationSeconds: 1e9 }` | `durationSeconds: 30` | Clamped high. |
| `{ durationSeconds: 1 }` | `durationSeconds: 1` | Lower bound is inclusive. |
| `{ durationSeconds: 30 }` | `durationSeconds: 30` | Upper bound is inclusive. |
| `{ durationSeconds: 7.6 }` | `durationSeconds: 8` | `Math.round(7.6) === 8`. |
| `{ durationSeconds: 7.4 }` | `durationSeconds: 7` | `Math.round(7.4) === 7`. |
| `{ durationSeconds: 7.5 }` | `durationSeconds: 8` | `Math.round` is half-up. |
| `{ durationSeconds: 0.4 }` | `durationSeconds: 1` | Rounds to `0`, then clamps to `1`. |
| `{ durationSeconds: 30.6 }` | `durationSeconds: 30` | Rounds to `31`, then clamps to `30`. |
| `{ durationSeconds: NaN }` | `durationSeconds: 5` | `Number.isFinite(NaN)` is `false`; default. |
| `{ durationSeconds: Infinity }` | `durationSeconds: 5` | Not finite; default. **Not** clamped to `30`. |
| `{ durationSeconds: -Infinity }` | `durationSeconds: 5` | Not finite; default. **Not** clamped to `1`. |
| `{ durationSeconds: '5' }` | `durationSeconds: 5` | String rejected; default happens to be `5`. |
| `{ durationSeconds: '7' }` | `durationSeconds: 5` | String rejected — the case that proves no coercion. |
| `{ durationSeconds: null }` | `durationSeconds: 5` | Wrong type; default. |
| `{ durationSeconds: true }` | `durationSeconds: 5` | Wrong type; default. |
| `{ shuffle: false }` | `shuffle: false`, rest default | A legitimate stored value survives. |
| `{ shuffle: 'false' }` | `shuffle: true` | Wrong type; default is `true`. (Does not by itself distinguish rejection from coercion; the `includeSubfolders: 'true'` and `shuffle: 0` rows below do.) |
| `{ shuffle: 'true' }` | `shuffle: true` | Wrong type; default. |
| `{ loop: 'false' }` | `loop: true` | Wrong type; default is `true`. |
| `{ includeSubfolders: 'true' }` | `includeSubfolders: false` | Wrong type; default is `false`. This is the pair that proves no truthiness coercion: a truthy string does **not** turn the option on. |
| `{ shuffle: 0 }` | `shuffle: true` | Wrong type; default. Truthiness would have given `false` — proves no coercion in the other direction. |
| `{ shuffle: 1 }` | `shuffle: true` | Wrong type; default. |
| `{ shuffle: null }` | `shuffle: true` | Wrong type; default. |
| `{ fillEmptySpace: undefined }` | `fillEmptySpace: true` | Present-but-undefined is treated as missing. |
| `{ durationSeconds: 12, shuffle: false, loop: false, animations: false, fillEmptySpace: false, startFullScreen: false, includeSubfolders: true }` | identical values | A fully specified valid record round-trips unchanged. |
| `{ durationSeconds: 99, shuffle: 'no', loop: true }` | `durationSeconds: 30`, `shuffle: true`, `loop: true`, rest default | Mixed validity: good fields are kept, bad fields default, per-field. |
| `{ durationSeconds: 9, nope: 1, theme: 'dark' }` | `durationSeconds: 9`, rest default, and no `nope` or `theme` key in the result | Unknown keys are dropped, not copied through. |
| `JSON.parse('{"__proto__":{"shuffle":false},"durationSeconds":9}')` | `durationSeconds: 9`, `shuffle: true`, no `__proto__` own key on the result, `Object.getPrototypeOf(result) === Object.prototype`, and `({}).shuffle` still `undefined` | `__proto__` is not one of the seven keys, so it is never read and never copied; the output literal has a clean prototype and nothing global is polluted. |
| an object whose prototype carries `{ shuffle: false }` (`Object.setPrototypeOf({ durationSeconds: 9 }, { shuffle: false })`) | `durationSeconds: 9`, `shuffle: true` | The `hasOwnProperty` guard in `own()` ignores inherited values. |
| `Object.create(null)` with `durationSeconds: 9` set on it | `durationSeconds: 9`, rest default | A null-prototype object must work; this is why reads use `Object.prototype.hasOwnProperty.call(...)` rather than `input.hasOwnProperty(...)`, which would throw on such an object. |

The `__proto__` row deserves a word of explanation for the implementer, because the two ways of producing that key behave differently in JavaScript. Writing `{ __proto__: {...} }` as an object literal *sets the prototype* and creates no own property. `JSON.parse('{"__proto__":{...}}')` creates a genuine own property named `__proto__`. The implementation above is immune to both: it reads only the seven known keys, each guarded by `hasOwnProperty`, and builds its result as a fresh literal. The test suite must cover the `JSON.parse` form specifically, since that is the form an attacker-controlled `localStorage` string actually produces.

### 4.7 Barrel update

Append to `shared/src/index.ts`, keeping whatever lines are already there:

```ts
export * from './config.js';
```

## 5. Acceptance criteria

- [ ] `shared/src/config.ts` exists and exports `SlideshowConfig`, `DEFAULT_CONFIG`, `MIN_DURATION_SECONDS`, `MAX_DURATION_SECONDS` and `parseConfig`.
- [ ] `SlideshowConfig` and `DEFAULT_CONFIG` are character-identical to specification §4.4, comments included.
- [ ] `MIN_DURATION_SECONDS === 1` and `MAX_DURATION_SECONDS === 30`.
- [ ] `parseConfig` has the signature `(input: unknown) => SlideshowConfig`.
- [ ] `parseConfig` never throws for any input in the section 4.6 table, including `Object.create(null)` and the `JSON.parse` `__proto__` payload.
- [ ] `parseConfig(undefined)` deep-equals `DEFAULT_CONFIG` but is not the same object reference.
- [ ] `Object.keys(parseConfig(anything))` has length 7 for every input in the table.
- [ ] `parseConfig` returns an integer in `[1, 30]` for `durationSeconds` on every input in the table, verified with `Number.isInteger`.
- [ ] `parseConfig` does not mutate its argument: a deep clone of the input taken before the call still deep-equals the input afterwards.
- [ ] No string or numeric value is ever coerced: `parseConfig({ durationSeconds: '7' }).durationSeconds === 5` and `parseConfig({ includeSubfolders: 'true' }).includeSubfolders === false`.
- [ ] `shared/src/config.ts` has no `import` statements and references no browser or Node global (`window`, `localStorage`, `process`, `Buffer`).
- [ ] `shared/src/index.ts` exports `./config.js` in addition to its existing exports.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` all pass.

## 6. Tests to write

Specification §12.1 requires unit coverage of "`parseConfig` clamping and coercion" in the `shared` package. The suite below covers every row of the section 4.6 table. Vitest, node environment.

**`shared/test/config.test.ts`** (import the subject from `'../src/index.js'`)

- `describe('DEFAULT_CONFIG')`
  - `it('sets durationSeconds to 5')`
  - `it('enables shuffle, loop, animations, fillEmptySpace and startFullScreen')`
  - `it('disables includeSubfolders, per resolved decision D1')`
  - `it('has exactly the seven SlideshowConfig keys')`
- `describe('duration bounds')`
  - `it('exposes MIN_DURATION_SECONDS as 1 and MAX_DURATION_SECONDS as 30, matching the §8.2 slider range')`
  - `it('places the default duration inside the bounds')`
- `describe('parseConfig with non-record input')`
  - `it('returns the defaults for undefined')`
  - `it('returns the defaults for null')`
  - `it('returns the defaults for a string')`
  - `it('returns the defaults for a number')`
  - `it('returns the defaults for a boolean')`
  - `it('returns the defaults for an empty array')`
  - `it('returns the defaults for a populated array')`
  - `it('returns the defaults for a function')`
  - `it('returns the defaults for an empty object')`
  - `it('returns a fresh object rather than a reference to DEFAULT_CONFIG')`
- `describe('parseConfig durationSeconds clamping')`
  - `it('clamps 0 up to 1')`
  - `it('clamps -5 up to 1')`
  - `it('clamps 31 down to 30')`
  - `it('clamps 1e9 down to 30')`
  - `it('accepts the inclusive lower bound 1')`
  - `it('accepts the inclusive upper bound 30')`
- `describe('parseConfig durationSeconds rounding')`
  - `it('rounds 7.6 to 8')`
  - `it('rounds 7.4 to 7')`
  - `it('rounds 7.5 up to 8, Math.round being half-up')`
  - `it('rounds 0.4 to 0 and then clamps it to 1')`
  - `it('rounds 30.6 to 31 and then clamps it to 30')`
  - `it('always returns an integer for a long list of fractional inputs')`
- `describe('parseConfig durationSeconds invalid values')`
  - `it('falls back to 5 for NaN')`
  - `it('falls back to 5 for Infinity rather than clamping to 30')`
  - `it('falls back to 5 for -Infinity rather than clamping to 1')`
  - `it('falls back to 5 for the string "5", which is rejected rather than coerced')`
  - `it('falls back to 5 for the string "7", proving string numerics are not coerced')`
  - `it('falls back to 5 for null')`
  - `it('falls back to 5 for true')`
  - `it('falls back to 5 for an object')`
- `describe('parseConfig boolean fields')`
  - `it('keeps a legitimate false for each of the six boolean options')` — loop over the six boolean keys.
  - `it('keeps a legitimate true for each of the six boolean options')`
  - `it('falls back to the default for the string "false"')`
  - `it('falls back to the default for the string "true"')`
  - `it('does not turn includeSubfolders on for the string "true"')`
  - `it('falls back to the default for 0, proving truthiness is not applied')`
  - `it('falls back to the default for 1')`
  - `it('falls back to the default for null')`
  - `it('treats a present-but-undefined field as missing')`
  - `it('falls back to the default for an object or array value')`
- `describe('parseConfig per-field recovery')`
  - `it('round-trips a fully specified valid configuration unchanged')`
  - `it('keeps valid fields and defaults only the invalid ones in a mixed record')`
  - `it('always returns exactly the seven SlideshowConfig keys')`
  - `it('drops unknown keys instead of copying them through')`
- `describe('parseConfig hostile input')`
  - `it('never throws for any input in the adversarial table')` — table-driven over every row; assert `expect(() => parseConfig(value)).not.toThrow()`.
  - `it('ignores a JSON-parsed __proto__ key and leaves the result prototype clean')`
  - `it('does not pollute Object.prototype when given a JSON-parsed __proto__ payload')`
  - `it('ignores values inherited from a tampered prototype')`
  - `it('handles an Object.create(null) input without throwing')`
  - `it('does not mutate its input')` — deep-clone-and-compare.
  - `it('returns a result whose durationSeconds is always an integer within 1..30')` — table-driven over every row.
- `describe('parseConfig idempotence')`
  - `it('returns an equal result when applied to its own output')` — `parseConfig(parseConfig(x))` deep-equals `parseConfig(x)` for every row of the table. This is the property the persistence layer depends on: a value written by the app and read back must survive unchanged.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] Every row of the section 4.6 adversarial-input table has a corresponding assertion.
- [ ] `parseConfig` is a total function: no input in the suite causes a throw.
- [ ] `@slydr/shared` still declares zero runtime dependencies, and `config.ts` imports nothing.
- [ ] The no-coercion decision is recorded as a comment in `config.ts`, not only in this ticket, so the next reader does not "fix" it.
- [ ] README updated if setup or user-visible behaviour changed (not expected for this ticket).

## 8. Notes and gotchas

- **This function is the persistence layer's only defence (specification §6.2).** The `slydr.config` entry in the persistence table lists its fallback as "`DEFAULT_CONFIG`, per field", and the surrounding rules require that every read goes through a validating parser, that a corrupt or stale value degrades silently, and that nothing throws. The client's storage layer will wrap `JSON.parse` in a `try`/`catch` and hand whatever comes out — possibly `undefined` on a parse failure — straight to `parseConfig`. If `parseConfig` can throw, the app breaks on load with a blank screen and no obvious cause, in a state the user cannot escape without clearing site data. Totality is the requirement, not a nicety.
- **Stale values are the common case, not the exotic one.** A `slydr.config` written by a build that predates resolved decision D1 has six keys and no `includeSubfolders`. Per-field defaulting handles that automatically, which is why whole-object rejection is wrong: a user who had set a 20-second duration should keep it across an upgrade that adds a field.
- **The `slydr.schemaVersion` key is a separate mechanism.** Specification §6.2 says a `schemaVersion` mismatch causes all other keys to be treated as absent. That check belongs to the storage layer, not here. `parseConfig` must behave correctly even when the version check has been bypassed or is wrong.
- **No runtime dependencies (specification §2.1).** `@slydr/shared` is "types + constants, no runtime deps", and it is bundled into the browser, where NFR-8 caps the bundle at 300 KB gzipped and NFR-9 forbids any outbound request. A hand-written validator of roughly 40 lines is the right size of solution; adding Zod for it would be a poor trade.
- **Do not reach for a generic deep-merge.** `{ ...DEFAULT_CONFIG, ...input }` looks like the same thing and is not: it copies unknown keys through, it accepts `durationSeconds: 'banana'`, and it is vulnerable to a `__proto__` own property in older runtimes. The explicit seven-field construction is deliberate.
- **`Math.round` versus `Math.trunc` versus `Math.floor`.** The specification says "rounds it to an integer", which is `Math.round`. `Math.trunc(7.6)` would give `7`, which is wrong. Do not substitute one for another to make a test pass; fix the test.
- **`Infinity` is not a large number.** `Number.isFinite(Infinity)` is `false`, so `Infinity` takes the invalid-value path and yields the default `5`, not the clamped `30`. This is a deliberate choice: `Infinity` cannot come from the slider, so it signals corruption rather than an out-of-range intent. It is called out as its own test case because the clamping intuition points the other way.
- **Keep the slider honest.** The configuration screen (specification §8.2) must set the range input's `min`/`max`/`step` from `MIN_DURATION_SECONDS`, `MAX_DURATION_SECONDS` and `1`, and must not perform its own clamping. The slider cannot produce an invalid value, so `parseConfig` exists purely for stored and external values — but `parseConfig` must stay the single authority, and the screen must call it after a "Reset to defaults" (specification §8.4) too.
- **Related assumption (specification §16.1, A1).** Usage is assumed single-tab, with no cross-tab `localStorage` synchronisation, so `parseConfig` never has to reconcile two concurrent writers. If A1 is ever revisited, a `storage`-event listener in the client would feed values through this same parser; no change here would be needed.
