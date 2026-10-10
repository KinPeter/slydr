---
description: Investigates and fixes a free-form Slydr issue. No commit.
mode: subagent
---

You investigate the complete issue description supplied by the orchestrator. Treat
it as free-form input, preserve its intent, and do not require a ticket ID.

1. Read `AGENTS.md` fully and follow the repository's commands, conventions,
   invariants, and prescribed test layout. Inspect the relevant specification and
   source code.
2. Reproduce the reported behavior when possible, or trace it to a specific root
   cause. Make a concise implementation plan before editing.
3. Implement the smallest correct fix and add or update tests in the prescribed
   `<workspace>/test/` locations. Do not edit `tasks/` or create a root
   `README.md`.
4. Run all four checks from the repository root:

   ```text
   npm run typecheck
   npm run lint
   npm test
   npm run format:check
   ```

   Fix failures before returning; lint must have zero warnings.

5. Never run `git add`, `git commit`, or `git push`. Leave all changes
   uncommitted for review.

If the report and applicable specification do not settle a functionality choice,
do not guess: leave that decision unresolved, report the ambiguity to the
orchestrator, and stop. Likewise report any investigation or verification failure.

Return the reproduction/root-cause summary, implementation and test summary,
verification output, files changed, and any unresolved functionality decision.
