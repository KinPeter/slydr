# `/handle-finding` workflow design

## Purpose

Add a free-form issue-handling workflow for reports such as:

> `/handle-finding I found some issues with the app. Please investigate and fix it...`

The workflow should investigate and implement a fix, independently review the
uncommitted changes, address review findings, run the repository verification
suite, and commit the completed repair. It must not change the existing
ticket-based `/implement-task` workflow.

## Integration surfaces

Maintain equivalent definitions in both integration directories:

- `.opencode/command/handle-finding.md`
- `.opencode/agents/slydr-issue-orchestrator.md`
- `.opencode/agents/slydr-issue-investigator.md`
- `.opencode/agents/slydr-issue-reviewer.md`
- `.opencode/agents/slydr-issue-fixer.md`
- `.claude/commands/handle-finding.md`
- `.claude/agents/slydr-issue-investigator.md`
- `.claude/agents/slydr-issue-reviewer.md`
- `.claude/agents/slydr-issue-fixer.md`

The OpenCode orchestrator is the primary-mode agent. The Claude command
contains equivalent orchestration instructions because Claude Code has no
primary-mode agent file. Existing ticket agents remain unchanged.

## Data flow and orchestration

`$ARGUMENTS` is the complete user issue description and is passed unchanged to
each issue-specific agent. The orchestrator performs these sequential stages:

1. Validate that the description is non-empty and that
   `git status --porcelain` is empty. If either check fails, stop and ask the
   user; do not modify files.
2. Spawn `slydr-issue-investigator`. It investigates the report, creates and
   follows an implementation plan, makes the smallest correct code and test
   changes, and reports any unresolved functionality decision instead of
   guessing.
3. Spawn `slydr-issue-reviewer` with the original description. It inspects
   the uncommitted diff read-only and writes a review report under
   `docs/reviews/` using a unique run-specific filename. The report includes
   a summary, findings with `BLOCKER`, `MAJOR`, or `MINOR` severity, and a
   clear `No findings.` result when appropriate.
4. Spawn `slydr-issue-fixer` with the original description and the exact review
   path. It fixes all findings, preserves or extends tests, and escalates
   unresolved behavior choices. It may make only this one fix pass.
5. Run `npm run typecheck`, `npm run lint`, `npm test`, and
   `npm run format:check` in the orchestrator. All must pass with zero lint
   warnings.
6. Stage all changes only after verification, confirm the staged set contains
   only intended files and never `node_modules/`, `dist/`, or `.env`, then
   commit a `fix:` message summarizing the issue. Do not push. Report the hash
   and ask the user to test manually.

Any investigator failure, reviewer/fixer functionality escalation, failed
verification, or unresolved `BLOCKER` after the single fix pass stops the
workflow without a commit.

## Agent responsibilities

### Issue investigator

Reads `AGENTS.md` and relevant project code, reproduces or traces the reported
behavior, identifies the root cause, and implements the fix. It must add or
update tests in the repository's prescribed test locations and run the four
standard checks before returning. It must not commit, edit task files, or
guess at behavior where the report and specification do not settle the choice.

### Issue reviewer

Reads `AGENTS.md`, the issue description, relevant specification material, and
the uncommitted diff. It evaluates whether the reported issue is actually
fixed, checks regressions, strict TypeScript and framework conventions, test
coverage, and formatting/lint implications. It is read-only with respect to
source code and writes only its run-specific review report.

### Issue fixer

Reads `AGENTS.md`, the issue description, the review report, and the changed
code. It fixes findings using the smallest correct diff, adds tests when
needed, and runs all four standard checks. It never edits the review report or
commits. It escalates behavior decisions rather than inventing requirements.

## Review report naming

The reviewer chooses a unique filename such as
`docs/reviews/finding-<UTC-timestamp>-review.md` and returns that exact path.
The orchestrator passes the path to the fixer. This avoids overwriting review
records when multiple findings are handled over time while keeping all reports
under the existing `docs/reviews/` directory.

## Error and safety rules

- The original issue description is preserved verbatim through all stages.
- No agent commits or pushes; only the final orchestrator step may commit.
- There is no automatic retry loop for implementation or review fixes.
- Functionality ambiguity is escalated to the user at the responsible stage.
- A dirty starting tree is never modified by this workflow.
- Generated files and secrets are rejected from the final staged set.

## Verification

The definitions themselves are configuration/documentation, so repository
verification is the existing command suite run by the orchestrator and the
issue agents:

```text
npm run typecheck
npm run lint
npm test
npm run format:check
```

Manual testing remains the user's responsibility after the orchestrator
reports the commit.
