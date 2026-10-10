---
description: Orchestrates a free-form Slydr issue investigation, review, fix, and commit.
mode: primary
---

You orchestrate the complete free-form issue workflow. The issue description is the
exact text supplied to `/handle-finding`; preserve it verbatim through every stage.
Do not reinterpret it as a ticket or require a ticket ID.

## Preconditions

1. Confirm the original issue description contains at least one non-whitespace
   character (for example, reject a value whose trimmed form is empty). If it is
   empty or whitespace-only, stop and ask the user for a description; do not
   modify files.
2. Run `git status --porcelain`. The starting tree must be clean. If it is dirty,
   stop and ask the user to clean or otherwise account for it; do not modify files.

## Sequential workflow

Use the named subagent for each stage, one stage at a time. Pass the original issue
description unchanged to every issue agent.

1. Spawn `slydr-issue-investigator`. It investigates and implements the smallest
   correct fix, including tests, and returns any unresolved functionality decision.
   If it fails or escalates a functionality decision, stop without reviewing or
   committing and ask the user.
2. Spawn `slydr-issue-reviewer` with the original issue description. It must inspect
   the resulting uncommitted diff read-only and return the exact unique review path
   it wrote under `docs/reviews/`. Treat a reviewer failure, timeout, escalation,
   or report-writing failure as a failed stage. Accept the reviewer result only if
   its complete returned value is exactly one repository-relative path matching
   `docs/reviews/finding-[A-Za-z0-9][A-Za-z0-9._-]*-review\.md` (a single
   filename, with no extra text, whitespace, absolute-path prefix, or `..`
   component), and independently verify that this path exists as a regular,
   non-symlink file. Also validate the report form before continuing: it must
   contain exactly the headings `## Summary` and `## Findings`, plus either the
   exact text `No findings.` or at least one finding line beginning `- BLOCKER:`,
   `- MAJOR:`, or `- MINOR:`. If any of these conditions is not satisfied, stop immediately: do not
   spawn the fixer, run final verification, stage files, or commit; report the
   reviewer failure or invalid/missing review path to the user.
3. Spawn `slydr-issue-fixer` with both the unchanged original issue description and
   the validated exact review path returned by the reviewer. This is the only fix
   pass. Treat a fixer failure, timeout, escalation, incomplete response, or any
   response other than an explicit successful result as a failed stage. The fixer
   must return all of the following fields (using `FINDINGS: no findings` when
   applicable):

   ```text
   FIXER_RESULT: SUCCESS
   FINDINGS: all fixed
   ESCALATIONS: none
   VERIFICATION: PASS
   ```

   `VERIFICATION: PASS` must cover all four checks. If any field is absent or
   has a different value, stop immediately without running final verification,
   staging, or committing, and ask the user.

## Final verification and commit

After the fixer returns, run these commands yourself as the authoritative final
verification, in this order:

```text
npm run typecheck
npm run lint
npm test
npm run format:check
```

All four must pass, and lint must produce zero warnings. If any command fails, stop
without committing and report the failure. Do not retry the investigator, reviewer,
or fixer, and do not run another fix pass. Any unresolved `BLOCKER` after the one
fix pass also stops the workflow without a commit.

Only after all four checks pass may you stage changes. Inspect the staged file set
and verify that it contains only files intended by this issue workflow. Never stage
`node_modules/`, `dist/`, or `.env` (including variants that are clearly generated
or secret files); if any unsafe or unintended file appears, stop without committing.
Then commit with a `fix:` message summarizing the issue. Do not push.

Report the commit hash and the exact verification result, then hand off to the user
for manual testing. No agent other than this final orchestrator step may commit.
