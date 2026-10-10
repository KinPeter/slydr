# `/handle-finding` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free-form `/handle-finding` command that investigates, reviews, fixes, verifies, and commits user-reported issues through dedicated agents.

**Architecture:** Define a dedicated OpenCode primary orchestrator and three issue-specific subagents. Add equivalent Claude Code command/agent instructions, while leaving ticket-based agents untouched. The reviewer writes a unique report under `docs/reviews/`, and the fixer consumes that exact path.

**Tech Stack:** Markdown command and agent definitions for OpenCode and Claude Code; repository shell commands for validation.

**Spec:** `docs/superpowers/specs/2026-10-10-handle-finding-design.md`

## Global Constraints

- Preserve the complete user issue description unchanged through every stage.
- Reject empty descriptions and dirty starting trees before modifying files.
- Run stages sequentially: investigator → reviewer → fixer → orchestrator verification.
- Agents never commit or push; only the orchestrator commits after final verification.
- Allow at most one fixer pass and escalate unresolved functionality decisions.
- Final gates are `npm run typecheck`, `npm run lint`, `npm test`, and `npm run format:check`.
- Never stage `node_modules/`, `dist/`, or `.env`.
- Keep `.opencode` and `.claude` command behavior synchronized.
- Do not modify the existing `/implement-task` workflow or ticket-specific agents.

## Review Focus

- **Empty or whitespace-only issue description:** command must stop before spawning an agent; test by checking the command/orchestrator instructions explicitly require non-empty validation.
- **Dirty initial working tree:** workflow must stop without modifying files; test by checking the preflight ordering and failure behavior.
- **Review report collision:** each reviewer run must use a unique `docs/reviews/finding-<UTC-timestamp>-review.md`-style path; test by checking the reviewer contract and fixer path handoff.
- **Reviewer finds no defects:** fixer must still receive the report and the workflow must proceed to final gates; test by checking the explicit `No findings.` contract.
- **Unresolved functionality choice or leftover blocker:** workflow must stop without committing; test by checking escalation and one-pass rules in both orchestrator variants.

---

### Task 1: Add the OpenCode issue workflow

**Files:**
- Create: `.opencode/command/handle-finding.md`
- Create: `.opencode/agents/slydr-issue-orchestrator.md`
- Create: `.opencode/agents/slydr-issue-investigator.md`
- Create: `.opencode/agents/slydr-issue-reviewer.md`
- Create: `.opencode/agents/slydr-issue-fixer.md`

**Interfaces:**
- Consumes: `$ARGUMENTS` as the complete free-form issue description.
- Produces: A command that dispatches the named agents sequentially; a review path returned by `slydr-issue-reviewer` and passed to `slydr-issue-fixer`.

- [ ] **Step 1: Define the `/handle-finding` command contract**

Write frontmatter with the command description and `agent: slydr-issue-orchestrator`. Document usage as `/handle-finding <issue description>` and pass the complete `$ARGUMENTS` unchanged to the orchestrator.

- [ ] **Step 2: Define the primary orchestrator**

Create `slydr-issue-orchestrator.md` with `mode: primary`. Specify non-empty-description and clean-tree preflight, sequential dispatch to the three issue agents, propagation of the original description and review path, escalation behavior, one-fix-pass maximum, authoritative final re-run of all four QA gates, staged-file safety checks, `fix:` commit, no push, and manual-test handoff.

- [ ] **Step 3: Define the issue investigator**

Create `slydr-issue-investigator.md` as a no-commit subagent. Require it to read `AGENTS.md`, investigate/reproduce the report, make and test the smallest correct fix, use the repository test layout, run all four QA gates, and escalate rather than guess when functionality is unclear.

- [ ] **Step 4: Define the issue reviewer**

Create `slydr-issue-reviewer.md` as a read-only source reviewer. Require it to inspect the original report and uncommitted diff, assess whether the issue is fixed plus regressions/conventions/test coverage, and write a unique report under `docs/reviews/` with `BLOCKER|MAJOR|MINOR` findings or `No findings.`. It must return the exact path and never edit source or commit.

- [ ] **Step 5: Define the issue fixer**

Create `slydr-issue-fixer.md` as a no-commit subagent accepting the issue description and review path. Require it to read the report without editing it, fix all findings in one pass, preserve/extend tests, run all four QA gates, and escalate unresolved functionality decisions or leftover blockers.

- [ ] **Step 6: Inspect the OpenCode definitions for contract consistency**

Check that every referenced agent name, argument, review path, stop condition, and QA command matches across the command, orchestrator, investigator, reviewer, and fixer files. Confirm no ticket ID or task-file dependency slipped into the issue workflow.

### Task 2: Add synchronized Claude Code mirrors

**Files:**
- Create: `.claude/commands/handle-finding.md`
- Create: `.claude/agents/slydr-issue-investigator.md`
- Create: `.claude/agents/slydr-issue-reviewer.md`
- Create: `.claude/agents/slydr-issue-fixer.md`

**Interfaces:**
- Consumes: The same complete `$ARGUMENTS` issue description and review-path handoff as the OpenCode workflow.
- Produces: Claude Code command instructions that orchestrate the same three issue-specific subagents and final QA/commit behavior.

- [ ] **Step 1: Mirror the command entry point**

Create `.claude/commands/handle-finding.md` with the same usage, preflight, sequential agent order, escalation rules, one-pass limit, final QA gates, staged-file protections, commit/no-push rule, and manual-test handoff. State that Claude Code performs orchestration in the command because it has no primary-mode orchestrator file.

- [ ] **Step 2: Mirror the investigator contract**

Create the Claude issue investigator definition with the same report handling, investigation, implementation, testing, escalation, and no-commit requirements as the OpenCode investigator.

- [ ] **Step 3: Mirror the reviewer contract**

Create the Claude issue reviewer definition with the same read-only diff review, unique `docs/reviews/` report, severity format, `No findings.` result, and no-commit requirements.

- [ ] **Step 4: Mirror the fixer contract**

Create the Claude issue fixer definition with the same review-path input, one-pass finding repair, test/QA requirements, escalation rules, and no-commit requirements.

- [ ] **Step 5: Compare the two integrations**

Diff the `.opencode` and `.claude` issue workflow instructions manually. Differences must be limited to OpenCode frontmatter/primary-agent dispatch versus Claude command-based orchestration and Claude-specific tool wording; behavior and safety requirements must remain equivalent.

### Task 3: Validate the workflow documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-handle-finding-design.md` only if implementation reveals a genuine contract mismatch
- Inspect: all files created in Tasks 1–2

**Interfaces:**
- Consumes: The approved design and implementation files.
- Produces: A clean, synchronized, repository-compliant workflow definition left unstaged and uncommitted for the user to review.

- [ ] **Step 1: Check Markdown and diff hygiene**

Run `git diff --check` and inspect `git status --short`. Confirm only the intended command, agent, and approved design/plan files are present; no generated output, dependency directory, build output, or environment file may appear.

- [ ] **Step 2: Verify all spec requirements**

Trace every design requirement to the created definitions: verbatim argument propagation, clean-tree preflight, three-agent sequence, unique review report, one fixer pass, functionality escalation, four authoritative final gates, staged-file safety, `fix:` commit, no push, and manual testing request.

- [ ] **Step 3: Run repository checks required for completion**

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run format:check`. These are documentation-only changes, but the repository gates must still be green before reporting completion.

- [ ] **Step 4: Leave changes unstaged and uncommitted**

Do not run `git add`, `git commit`, or `git push`; report the files and verification results for user review.
