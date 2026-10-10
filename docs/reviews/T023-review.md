# T023 review — 2026-10-10

| # | Acceptance criterion | Result |
|---|---|---|
| 1 | `storage.ts` exports `STORAGE_KEYS` (six key strings), `SCHEMA_VERSION` (1), `WRITE_DEBOUNCE_MS` (250) | PASS |
| 2 | Empty storage: `readTheme()` null, `readExplorerPrefs()` `{list,false,''}`, `readConfig()` deep-equals `DEFAULT_CONFIG` | PASS |
| 3 | `readTheme()` null for anything but `light`/`dark` | PASS |
| 4 | `viewMode` `list` unless `grid`; `showHidden` true only for `"true"` | PASS |
| 5 | `lastPath` rejects non-strings/NUL/>4096/abs/drive/`\\`/`..`, accepts `"Pictures/2024"` and `""` | PASS |
| 6 | `readConfig()` on malformed JSON / JSON null / hand-edited object never throws, clamps per `parseConfig` | PASS |
| 7 | `localStorage` access/get/set throwing: nothing throws, nothing logged | PASS |
| 8 | Storage unavailable: written value returned by next same-session read | PASS |
| 9 | Five rapid `lastPath` writes coalesce to one `setItem` with last value at +250 ms | PASS |
| 10 | Pending write committed by `pagehide` and hidden `visibilitychange`, exactly once | PASS |
| 11 | Visible `visibilitychange` commits nothing | PASS |
| 12 | `writeTheme`/`clearTheme` synchronous, never stamp `slydr.schemaVersion` | PASS |
| 13 | First debounced non-theme write stamps `slydr.schemaVersion` = `1` | PASS |
| 14 | Version `2`: readers default except theme; reads modify nothing | PASS |
| 15 | First write after mismatch purges `slydr.*` except theme, writes value, sets version `1` | PASS |
| 16 | `clearLastPath()` removes key immediately, cancels pending write | PASS |
| 17 | No `usePersisted`/`readRaw`/`scheduleWrite`/`PersistedKey` exports, no `usePersisted.ts` | PASS |
| 18 | `theme.ts` delegates to `storage.ts`, keeps exports, unchanged T021 suites pass | PASS |
| 19 | No `localStorage` in `client/src` outside `storage.ts` | PASS |

Verified: targeted suites green (5 files, 113 tests incl. all four T021 regression suites), `npm run typecheck`, `npm run lint`, Prettier check all green.

client/src/state/storage.ts:64: MINOR UNC-prefix check uses a one-char backslash (`'\\'`) instead of the ticket's two-char UNC prefix (`'\\\\'`), so a legal POSIX name starting with a single backslash (e.g. `\foo`) is rejected. Use `value.startsWith('\\\\')` per §4.2 (backslash is a legal POSIX filename char per §8 notes).
client/src/state/storage.ts:296: MINOR `clearLastPath()` deletes the shadow entry before `removeItem`, so if `removeItem` throws while `getItem` still works the next read returns the stale stored value instead of `""`. Set `shadow` to `null` for the key when the removal fails (or unconditionally, deleting it only on success) so the postcondition `readExplorerPrefs().lastPath === ""` holds in every failure case.
