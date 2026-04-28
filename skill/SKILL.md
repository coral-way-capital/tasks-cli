---
name: tasks-cli
description: Manage task specs using the tasks CLI. Tasks are markdown files stored in .tasks/ within the current project. Use when creating, listing, showing, updating, or managing tasks, or when the user mentions task management, triaging work, or tracking specs. Supports dependency graphs for execution planning and GitHub Issues/PR integration via the gh CLI.
---

# Tasks CLI

Base directory for this skill: .

## Instructions

Manage task specs using the `tasks` CLI. Tasks are markdown files stored in `.tasks/` within the current project directory. Each task has YAML frontmatter (id, title, status, priority, type, timestamps, optional dependencies, optional GitHub links) and a freeform markdown body (the spec).

Use this skill when the user asks to create, list, show, update, or manage tasks. Also use proactively when the user mentions task management, triaging work, or tracking specs. Use the GitHub commands when the user mentions issues, PRs, syncing with GitHub, or linking tasks to pull requests.

### Command Reference

**Create a task:**
```bash
tasks new "Title here" -p <priority> -t <type> --depends-on <id> --body <<'EOF'
## Description
Full description here.

## Acceptance criteria
- [ ] Criterion one
- [ ] Criterion two
EOF
```

Priorities: `p0` (critical), `p1` (important, default), `p2` (nice-to-have)
Types: `bug`, `feat` (default), `refactor`, `test`, `docs`

**List tasks:**
```bash
tasks list                          # Open + in-progress tasks (shows DEPS column)
tasks list --status open            # Filter by status
tasks list --priority p0            # Filter by priority
tasks list --type bug               # Filter by type
tasks list --status open -p p0      # Combine filters (AND)
```

**Show a task:**
```bash
tasks show <id>                     # Full detail (accepts partial ID, min 4 chars)
                                    # Shows Deps, Blocks, GitHub issue/PR links
```

**Update status:**
```bash
tasks status <id> in-progress       # Start work (validates deps are done)
tasks status <id> blocked           # Blocked
tasks status <id> cancelled         # Cancel
```

Statuses: `open` → `in-progress` → `done` (also: `blocked`, `cancelled`)

**Mark done:**
```bash
tasks done <id>                     # Shorthand for status → done
                                    # Auto-shows unblocked dependents
```

**Edit a task:**
```bash
echo "New body content" | tasks edit <id> --body        # Replace body via stdin
tasks edit <id>                                          # Open in $EDITOR
tasks edit <id> --depends-on id1,id2                     # Update dependencies (validates no cycles)
```

**Dependency graph:**
```bash
tasks graph                      # Human-readable execution plan with waves
tasks graph --json               # Machine-readable JSON with full dependency info
```

**Execution plan:**
```bash
tasks plan                       # JSON execution plan (waves for parallel execution)
tasks plan --status              # Human-readable: ready / blocked / in-progress
tasks plan --bash                # Shell script with wave-by-wave task_work calls
tasks plan --all                 # Include done/cancelled tasks in plan
```

### GitHub Integration

Sync tasks with GitHub Issues and track PRs. Requires the `gh` CLI installed and the project must have a GitHub remote.

**Enable/disable integration:**
```bash
tasks github                      # Show integration status
tasks github enable               # Enable (validates gh CLI + GitHub repo)
tasks github disable              # Disable
tasks github status               # Detailed sync status with drift detection
```

**Sync tasks with GitHub:**
```bash
tasks sync push                   # Push all local tasks → GitHub Issues
tasks sync pull                   # Pull GitHub Issue state → local tasks
tasks sync                        # Full bidirectional sync (pull then push)
tasks sync check                  # Dry-run: preview changes without applying
tasks sync push --task <id>       # Push a single task
tasks sync pull --task <id>       # Pull a single task
```

**PR tracking:**
```bash
tasks pr link <task-id> <pr-num>  # Link a PR to a task (comments on issue)
tasks pr list                     # List all tasks with linked PRs
tasks pr list <task-id>           # Show PRs for a specific task
tasks pr status                   # Show merge status (state + mergeable) of linked PRs
```

**Auto-sync mode:**
When enabled in `.tasks/config.json`, every `new`, `status`, `done`, and `edit` command automatically pushes changes to GitHub:
```json
{
  "github": {
    "enabled": true,
    "labels": ["task"],
    "autoSync": true
  }
}
```

**Status ↔ Issue state mapping:**

| Local Status | GitHub Issue State | Labels |
|---|---|---|
| `open` | Open | `task` |
| `in-progress` | Open | `task`, `in-progress` |
| `blocked` | Open | `task`, `blocked` |
| `done` | Closed | — |
| `cancelled` | Closed | — |

**Sync conflict resolution:**
- **Title conflict** (local ≠ remote): Local wins, overwrites remote
- **State conflict** (local open, remote closed): Remote wins (someone closed it on GitHub)
- **State conflict** (local done, remote open): Remote wins (someone reopened it)

**Dependency cross-referencing (automatic):**

When `tasks sync push` creates GitHub Issues, it automatically:
1. **Injects dependency sections** into each issue body — tasks with `dependsOn` get a `## Dependencies` section listing their dependencies with issue number links (`#42`) or task IDs (`` `abcd1234` `` for unlinked tasks). Tasks that are depended upon get a `## Blocks` section.
2. **Posts cross-reference comments** on related issues — when task B depends on task A, a `🔓 Blocks: #B — B title` comment is posted on issue A, and a `📦 Depends on: #A — A title` comment is posted on issue B.
3. **Config labels** from `.tasks/config.json` are applied to all created issues. Labels like `"5.6"` or `"epic:auth"` are automatically added.

This means you do NOT need to manually add dependency info to task bodies or post cross-reference comments — `sync push` handles it natively.

### Dependencies

Tasks can declare dependencies on other tasks using `--depends-on <id>`. Dependencies affect:

- **Status transitions**: You cannot set a task to `in-progress` or `open` if its dependencies are not all `done`.
- **List display**: Tasks with unfinished deps show as `blocked` in the list output.
- **Auto-unblock**: When you mark a task `done`, dependent tasks that become unready are shown.
- **Cycle detection**: The CLI rejects dependency changes that would create cycles.

**Creating dependent tasks:**
```bash
# Create base task first
tasks new "Set up database schema" -p p0

# Then create dependent task
tasks new "Build user API" --depends-on a1b2c3d4 -p p0
```

**Multiple dependencies:**
```bash
tasks new "Integration tests" --depends-on a1b2c3d4 --depends-on e5f6g7h8
```

**Updating dependencies:**
```bash
tasks edit <id> --depends-on id1,id2,id3
```

### Agent Workflow

**Triage manager (creates tasks with dependencies):**
```bash
tasks new "Set up database schema" -p p0 -t feat --body <<'EOF'
## Description
Create the core database tables and migrations.

## Files involved
- `src/db/schema.ts`

## Acceptance criteria
- [ ] Tables created
- [ ] Migrations run
EOF

# Capture the ID from output
BASE_ID=$(tasks new "Set up database schema" -p p0 -t feat | grep -oP '[a-f0-9]{8}')

tasks new "Build user API" -p p0 -t feat --depends-on $BASE_ID --body <<'EOF'
## Description
REST endpoints for user CRUD operations.

## Files involved
- `src/api/users.ts`

## Acceptance criteria
- [ ] GET /users
- [ ] POST /users
EOF
```

**Engineer (checks execution plan before starting work):**
```bash
tasks plan --status              # See what's ready, blocked, in-progress
tasks show <id>                  # Read the spec
tasks status <id> in-progress    # Claim it
# ... do the work ...
tasks done <id>                  # Mark complete (shows newly unblocked tasks)
```

**Orchestrator (wave-based execution with task_work):**
```bash
# Use the task_work tool/extension with DAG mode:
#   - Slash command: /task-work --dag
#   - Tool call: task_work with mode: "dag"
#
# DAG mode calls `tasks plan --json`, executes each wave in parallel,
# waits for all tasks in a wave to complete, then starts the next wave.
# Tasks are automatically marked done/failed per-wave.
#
# Or get a ready-to-run bash script for manual execution:
tasks plan --bash
```

**GitHub-enabled workflow:**
```bash
# One-time setup
tasks github enable

# Create tasks normally — they auto-sync if autoSync is on
tasks new "Fix auth bug" -p p0 -t bug --body <<'EOF'
## Description
JWT tokens with expired exp claims are not rejected.
EOF

# Or manually sync when ready
tasks sync push

# After finishing work, link the PR
tasks pr link abcd1234 42

# Check overall status
tasks github status
tasks pr status
```

**Loop checker (monitors progress):**
```bash
tasks plan --status              # Summary of ready/blocked/in-progress
tasks list                       # See all open work
```

### Capturing IDs

The `new` command outputs: `Created task <id>: <title>`. Extract the ID for subsequent commands:
```bash
tasks new "My task" | grep -oP '[a-f0-9]{8}'
```

### Important Notes

- Tasks are scoped to the current working directory's `.tasks/` folder
- IDs are 8-char hex strings; partial matching works with minimum 4 characters
- The `--body` flag reads from stdin — always use heredoc syntax (`<<'EOF'`) for multi-line body content to avoid shell escaping issues
- The `list` command defaults to excluding `done` and `cancelled` tasks; use `--all` to see everything
- All modifying commands automatically update the `updated` timestamp
- Tasks with unfinished dependencies cannot be started (`in-progress`) — the CLI enforces this
- The `graph` and `plan` commands compute the full dependency DAG and show execution waves
- GitHub integration requires `gh` CLI installed and a GitHub remote configured on the repo
- `githubIssue` and `githubPR` fields are persisted in task frontmatter after linking
- Auto-sync failures are non-blocking (warning only, never breaks the primary command)

## Examples

**User: "Create a task for the auth bug"**
```bash
tasks new "Fix JWT expiry validation" -p p0 -t bug --body <<'EOF'
## Description
Tokens with expired exp claims are not rejected.

## Files involved
- src/auth/token.ts — validateToken function

## Acceptance criteria
- [ ] Expired tokens rejected
- [ ] Test covers expiry edge case
EOF
```

**User: "What tasks are open?"**
```bash
tasks list
```

**User: "Show me task abcd"**
```bash
tasks show abcd
```

**User: "Mark task abcd as in progress"**
```bash
tasks status abcd in-progress
```

**User: "I finished task abcd"**
```bash
tasks done abcd
```

**User: "Show the dependency graph"**
```bash
tasks graph
```

**User: "What can I work on right now?"**
```bash
tasks plan --status
```

**User: "What's the execution plan?"**
```bash
tasks plan              # JSON waves for programmatic use
tasks plan --bash       # Shell script with task_work calls per wave
```

**User: "Sync tasks to GitHub"**
```bash
tasks github enable
tasks sync push
```

**User: "Link PR #42 to task abcd"**
```bash
tasks pr link abcd 42
```

**User: "Check sync status"**
```bash
tasks github status
tasks pr status
```
