# tasks — task spec manager

A minimal CLI that manages task specs as markdown files in a `.tasks/` directory, scoped to the current project. Designed to be the shared contract between AI agents and humans.

## Install

```bash
# Make available globally
ln -sf $(pwd)/src/cli.ts /usr/local/bin/tasks
# Or run directly
bun run src/cli.ts <command>
```

## Quick Start

```bash
# Create tasks
tasks new "Fix auth token expiry" -p p0 -t bug
tasks new "Add rate limiting" -p p1 -t feat

# List and manage
tasks list
tasks show abcd1234
tasks status abcd1234 in-progress
tasks done abcd1234

# View execution plan (dependency-aware)
tasks graph
tasks plan --status
```

## Commands

| Command | Description |
|---------|-------------|
| `new <title>` | Create a task |
| `list` | List/filter tasks |
| `show <id>` | Show task detail |
| `graph` | Show dependency graph & execution plan |
| `plan` | Execution plan (`--json`, `--status`, `--bash`) |
| `status <id> <status>` | Update status |
| `done <id>` | Mark task done |
| `edit <id>` | Edit task |
| `github` | GitHub integration (`enable`, `disable`, `status`) |
| `sync` | Sync with GitHub (`push`, `pull`, `check`) |
| `pr` | PR integration (`link`, `list`, `status`) |

## Task File Format

Tasks are stored as markdown files in `.tasks/`:

```markdown
---
id: a1b2c3d4
title: "Fix auth token expiry validation"
status: open
priority: p1
type: bug
dependsOn: []
githubIssue: 42
githubPR: 128
created: 2025-03-30T14:22:00Z
updated: 2025-03-30T14:22:00Z
---

## Description

The JWT validation doesn't check the `exp` claim properly.

## Files involved

- `src/auth/token.ts`

## Acceptance criteria

- [ ] Token with expired `exp` is rejected
```

### Statuses

`open` → `in-progress` → `done` (also: `blocked`, `cancelled`)

### Priorities

`p0` (critical), `p1` (important), `p2` (nice-to-have)

### Types

`bug`, `feat`, `refactor`, `test`, `docs`

## GitHub Integration

Sync tasks with GitHub Issues and track PRs — all via the `gh` CLI, no tokens to manage.

### Setup

```bash
# Enable (validates gh CLI + GitHub repo)
tasks github enable

# Push all tasks as issues
tasks sync push

# Pull remote changes back
tasks sync pull

# Full bidirectional sync
tasks sync

# Dry-run to preview changes
tasks sync check
```

### PR Tracking

```bash
# Link a PR to a task
tasks pr link abcd1234 42

# Show merge status of linked PRs
tasks pr status

# List all linked PRs
tasks pr list
```

### Auto-Sync

Enable automatic pushing on every local change by editing `.tasks/config.json`:

```json
{
  "github": {
    "enabled": true,
    "labels": ["task"],
    "autoSync": true
  }
}
```

When `autoSync` is on, `new`, `status`, `done`, and `edit` commands automatically push changes to GitHub.

### Status Mapping

| Local Status | GitHub Issue State | Labels |
|---|---|---|
| `open` | Open | `task` |
| `in-progress` | Open | `task`, `in-progress` |
| `blocked` | Open | `task`, `blocked` |
| `done` | Closed | — |
| `cancelled` | Closed | — |

### Sync Conflict Resolution

- **Title conflict** (local ≠ remote): Local wins, overwrites remote
- **State conflict** (local open, remote closed): Remote wins (someone closed it on GitHub)
- **State conflict** (local done, remote open): Remote wins (someone reopened it)

### Dependency Cross-Referencing

When `tasks sync push` creates GitHub Issues, it automatically:

1. **Injects dependency sections** into each issue body — tasks with `dependsOn` get a `## Dependencies` section with issue number links. Tasks that are depended upon get a `## Blocks` section.
2. **Posts cross-reference comments** on related issues — upstream issues get `🔓 Blocks: #N` comments, downstream issues get `📦 Depends on: #N` comments.
3. **Applies config labels** from `.tasks/config.json` (e.g. `["task", "5.6"]`) to all created issues.

## Configuration

Project-level config lives in `.tasks/config.json`:

```json
{
  "github": {
    "enabled": false,
    "labels": ["task"],
    "autoSync": false
  }
}
```

## Development

```bash
# Run tests
bun test

# Run CLI directly
bun run src/cli.ts <command>
```

## Architecture

```
src/
  cli.ts              Entry point, argument parsing
  types.ts            Shared types
  commands/
    new.ts            Create a task
    list.ts           List/filter tasks
    show.ts           Display a single task
    graph.ts          Dependency graph
    plan.ts           Execution plan
    status.ts         Update status
    done.ts           Mark task done
    edit.ts           Edit task
    github.ts         GitHub integration management
    sync.ts           Bidirectional GitHub sync
    pr.ts             PR linking and status
  lib/
    task.ts           Parse/serialize task markdown
    store.ts          Read/write .tasks/ directory
    id.ts             ID generation
    format.ts         Terminal output formatting
    dag.ts            Dependency graph & topological sort
    config.ts         Project-level configuration
    github.ts         GitHub CLI bridge (gh)
    auto-sync.ts      Auto-push on local mutations
```
