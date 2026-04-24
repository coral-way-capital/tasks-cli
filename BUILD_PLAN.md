# Build plan: `tasks` CLI

## Overview

A minimal Bun/TypeScript CLI that manages task specs as markdown files in a `.tasks/` directory, scoped to the current project. Designed to be the shared contract between `triage-manager` (creates tasks) and `staff-eng` (consumes and completes tasks).

## Design decisions

**Storage:** Flat `.tasks/` directory with `{8-char-hex-id}.md` files. No database, no config file, no lock files. The directory IS the state. Add `.tasks/` to `.gitignore` or commit it — user's choice.

**IDs:** First 8 hex chars from `crypto.randomUUID()` (e.g. `a1b2c3d4`). Short enough for agents to reference in prompts, unique enough for any project. Collision probability at 1000 tasks: ~0.002%.

**Frontmatter:** YAML frontmatter with structured metadata. Body is freeform markdown (the spec). This means tasks are both machine-parseable (frontmatter) and human/agent-readable (body).

**Scope:** Always operates on `.tasks/` relative to `process.cwd()`. No global state, no cross-project awareness.

**No git integration:** Per your request. Tasks are orthogonal to commits.

---

## Architecture

```
src/
  cli.ts          — Entry point, argument parsing (no library, just process.argv)
  commands/
    new.ts        — Create a task
    list.ts       — List/filter tasks  
    show.ts       — Display a single task
    status.ts     — Update task status
    done.ts       — Shorthand for status → done
    edit.ts       — Open task in $EDITOR or replace body from stdin
  lib/
    task.ts       — Task type, parse/serialize frontmatter+body
    store.ts      — Read/write/list .tasks/ directory
    id.ts         — ID generation (8-char hex from crypto.randomUUID)
    format.ts     — Terminal output formatting (colors, tables)
  types.ts        — Shared types
```

Single `package.json` with `"bin": { "tasks": "./src/cli.ts" }` and a shebang `#!/usr/bin/env bun` at top of `cli.ts`.

---

## Task file format

```markdown
---
id: a1b2c3d4
title: "Fix auth token expiry validation"
status: open
priority: p1
type: bug
created: 2025-03-30T14:22:00Z
updated: 2025-03-30T14:22:00Z
---

## Description

The JWT validation doesn't check the `exp` claim properly...

## Files involved

- `src/auth/token.ts` — validateToken function
- `src/middleware/auth.ts` — where it's called

## Acceptance criteria

- [ ] Token with expired `exp` is rejected
- [ ] Test covers expiry edge case
- [ ] Types clean
```

### Statuses

`open` → `in-progress` → `done` (also: `blocked`, `cancelled`)

### Priorities

`p0` (critical), `p1` (important), `p2` (nice-to-have)

### Types

`bug`, `feat`, `refactor`, `test`, `docs`

---

## Commands

### `tasks new <title> [options]`

Creates a new task file in `.tasks/`.

```
tasks new "Fix auth token expiry" --priority p0 --type bug
```

Options:
- `--priority, -p` — p0/p1/p2 (default: p1)
- `--type, -t` — bug/feat/refactor/test/docs (default: feat)

Behavior:
1. Create `.tasks/` if it doesn't exist
2. Generate 8-char hex ID
3. Write markdown file with frontmatter + template body
4. Print: `Created task a1b2c3d4: Fix auth token expiry`

The template body includes section headers (Description, Files involved, Acceptance criteria) so agents or humans can fill them in.

### `tasks list [options]`

Lists tasks with filtering.

```
tasks list                    # All non-done tasks
tasks list --all              # Everything including done
tasks list --status open      # Only open
tasks list --priority p0      # Only P0
tasks list --type bug         # Only bugs
```

Output format (compact table):
```
ID        PRI  TYPE     STATUS       TITLE
a1b2c3d4  p0   bug      open         Fix auth token expiry
e5f6g7h8  p1   feat     in-progress  Add rate limiting
i9j0k1l2  p2   refactor open         Extract validation module
```

Sorted by: priority (p0 first), then created date (oldest first).

### `tasks show <id>`

Displays full task content (frontmatter + body).

```
tasks show a1b2
```

Accepts partial ID prefix match (minimum 4 chars). If ambiguous, show matches and ask to be more specific.

### `tasks status <id> <new-status>`

Updates the status field.

```
tasks status a1b2 in-progress
tasks status a1b2 done
tasks status a1b2 blocked
```

Also updates the `updated` timestamp.

### `tasks done <id>`

Shorthand for `tasks status <id> done`.

```
tasks done a1b2
```

### `tasks edit <id>`

Opens the task file in `$EDITOR`. If `$EDITOR` is not set, prints the file path instead.

```
tasks edit a1b2
```

Also supports piping body content via stdin:
```
echo "Updated description" | tasks edit a1b2 --body
```

This is how agents will update task specs programmatically — they can also just write to the file directly since it's plain markdown.

---

## Tasks for building this CLI

These are written as task specs that `triage-manager` would create and `staff-eng` would execute. Build in this order — each depends on the ones before it.

### Task 1: Project scaffold + types + ID generation

**Priority:** p0  
**Type:** feat

Set up the Bun project with `package.json`, `tsconfig.json`, and the directory structure. Implement:

- `src/types.ts` — `Task` interface with all frontmatter fields, `TaskStatus` and `TaskPriority` and `TaskType` union types
- `src/lib/id.ts` — `generateId()` function: takes first 8 hex chars from `crypto.randomUUID().replace(/-/g, '')`  
- `src/cli.ts` — shebang + bare argument parser that routes to command handlers (just stubs for now)

Tests:
- `generateId()` returns 8 hex chars
- `generateId()` returns unique values across 100 calls
- CLI with no args prints usage

Acceptance criteria:
- `bun run src/cli.ts` prints usage help
- `bun test` passes
- Types compile clean

### Task 2: Store module (read/write .tasks/)

**Priority:** p0  
**Type:** feat

Implement `src/lib/store.ts`:

- `ensureTaskDir()` — creates `.tasks/` if missing
- `writeTask(task: Task, body: string)` — serializes frontmatter + body to `{id}.md`
- `readTask(id: string)` — parses frontmatter + body from file, returns `{ task: Task, body: string }`
- `listTasks()` — reads all `.md` files in `.tasks/`, returns parsed array
- `resolveId(partial: string)` — finds task by prefix match (min 4 chars), throws if ambiguous or not found
- `updateFrontmatter(id: string, updates: Partial<Task>)` — reads file, updates frontmatter fields, rewrites

Frontmatter parsing: Use a simple hand-rolled parser — split on `---` boundaries, parse YAML-like `key: value` lines. No external YAML library needed since our frontmatter is flat key-value pairs with simple string/date values.

Tests:
- Write then read roundtrip preserves all fields
- `resolveId` with 4-char prefix finds the right task
- `resolveId` with ambiguous prefix throws descriptive error
- `listTasks` on empty dir returns `[]`
- `updateFrontmatter` changes only specified fields, preserves body

Acceptance criteria:
- All store operations work on a temp directory
- No external dependencies
- Body content (markdown after frontmatter) is preserved exactly

### Task 3: `new` command

**Priority:** p0  
**Type:** feat

Implement `src/commands/new.ts`:

- Parse args: `tasks new "title" --priority p1 --type feat`
- Call `ensureTaskDir()`, `generateId()`, `writeTask()`
- Print confirmation with ID and title
- Template body includes `## Description`, `## Files involved`, `## Acceptance criteria` sections

Tests:
- Creates file in `.tasks/` with correct filename
- Frontmatter has all required fields
- Default priority is p1, default type is feat
- `--priority p0` overrides default
- Title with spaces works
- Created timestamp is ISO format

### Task 4: `list` command

**Priority:** p0  
**Type:** feat

Implement `src/commands/list.ts`:

- No flags: show all tasks with status != `done` and status != `cancelled`
- `--all`: show everything
- `--status <s>`: filter by status
- `--priority <p>`: filter by priority
- `--type <t>`: filter by type
- Sort: priority (p0 > p1 > p2), then created date ascending
- Format as aligned columns: ID, PRI, TYPE, STATUS, TITLE

Tests:
- Default excludes done/cancelled tasks
- `--all` includes everything
- `--status open` filters correctly
- `--priority p0` filters correctly
- Multiple filters combine (AND)
- Empty result prints "No tasks found"
- Output is sorted correctly

### Task 5: `show`, `status`, `done` commands

**Priority:** p1  
**Type:** feat

Implement:

- `src/commands/show.ts` — resolve partial ID, print full file content with light formatting
- `src/commands/status.ts` — resolve partial ID, validate new status, call `updateFrontmatter`
- `src/commands/done.ts` — resolve partial ID, set status to `done`

All three update the `updated` timestamp when modifying.

Tests:
- `show` with 4-char prefix works
- `show` with invalid ID prints error
- `status` transitions: open → in-progress, in-progress → done, any → blocked, any → cancelled
- `done` is equivalent to `status done`
- `updated` timestamp changes on status update

### Task 6: `edit` command + CLI polish

**Priority:** p2  
**Type:** feat

Implement:

- `src/commands/edit.ts` — opens `$EDITOR` or prints path
- `--body` flag reads from stdin and replaces body (keeps frontmatter)
- `src/lib/format.ts` — colored terminal output (use ANSI codes directly, no chalk)
- Help text for each command (`tasks help`, `tasks new --help`)
- Error handling polish: friendly messages for missing `.tasks/`, invalid args, file not found

Tests:
- `--body` via stdin replaces body, preserves frontmatter
- Missing `$EDITOR` prints file path instead of crashing
- Invalid command prints usage
- Colored output can be disabled with `NO_COLOR=1`

---

## Integration with agents

Once the CLI is built, the agents should use the CLI commands instead of raw `sed` and `cat`. Here's how the flow works:

**Triage manager creates tasks:**
```bash
TASK_ID=$(tasks new "Fix auth token expiry" -p p0 -t bug | grep -oP '[a-f0-9]{8}')
tasks edit $TASK_ID --body <<'SPEC'
## Description
The JWT validation doesn't check the exp claim...

## Files involved
- `src/auth/token.ts`

## Acceptance criteria
- [ ] Expired tokens rejected
- [ ] Test added
SPEC
```

**Triage manager checks progress:**
```bash
tasks list
tasks list --status in-progress
```

**Staff-eng picks up work:**
```bash
tasks show $TASK_ID          # Read the spec
tasks status $TASK_ID in-progress   # Claim it
# ... do the work ...
tasks done $TASK_ID          # Mark complete
```

**Loop-continuer checks completion:**
```bash
# Count remaining open tasks
REMAINING=$(tasks list --status open | wc -l)
if [ "$REMAINING" -eq 0 ]; then
  # All tasks done, stop the loop
fi
```
