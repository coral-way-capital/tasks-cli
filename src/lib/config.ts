import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { getTasksDir, ensureTaskDir } from "../lib/store";

export interface TasksConfig {
  github?: {
    enabled: boolean;
    labels?: string[];
    autoSync?: boolean;
  };
}

export function loadConfig(): TasksConfig {
  const filePath = join(getTasksDir(), "config.json");
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as TasksConfig;
  } catch (e) {
    throw new Error(
      `Failed to parse ${filePath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export function saveConfig(config: TasksConfig): void {
  ensureTaskDir();
  const filePath = join(getTasksDir(), "config.json");
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function isGithubEnabled(): boolean {
  const config = loadConfig();
  return !!config.github?.enabled;
}

export function ensureGithubPrerequisites(): { owner: string; repo: string } | string {
  try {
    execSync("which gh", { stdio: "pipe" });
  } catch {
    return "gh CLI not found. Install it from https://cli.github.com/";
  }

  let nameWithOwner: string;
  try {
    nameWithOwner = execSync(
      'gh repo view --json nameWithOwner -q .nameWithOwner',
      { stdio: "pipe", encoding: "utf-8" }
    ).trim();
  } catch {
    return "Not a GitHub repository. Make sure you're in a repo with a GitHub remote.";
  }

  const [owner, repo] = nameWithOwner.split("/");
  return { owner, repo };
}
