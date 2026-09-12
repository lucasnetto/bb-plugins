# Worker assignment

Use concrete values; omit sections irrelevant to the task.

- **Outcome and acceptance:** What must work, with one observable example.
- **Decisions:** Agreed compatibility or rollout constraints not captured in code.
  Carry them from the conversation; no separate design document is required.
- **Owner and scope:** Worker, repository, environment/worktree, branch, files
  it alone may edit, and existing user changes it must preserve.
- **Dependencies:** Other owners and the exact input needed from each.
- **Completion:** Implement, run relevant checks, fix failures, review the diff,
  and provide the PR handoff. Include the permissions already granted for push
  and PR creation; do not infer merge or deployment approval.
- **Handoff evidence:** Changed files, checks and their outcomes, unresolved
  limitations, and either the linked PR or prepared title/body plus final diff.
- **Coordination:** Report startup blockers promptly. Further delegation is
  disallowed unless explicitly authorized. Keep ownership until the parent
  confirms a transfer or accepts the deliverable.

For a transfer, record: old owner → new owner; old worker stopped; current diff
and branch; completed checks; remaining work; updated exclusive file scope.
