export type TaskStatus = "open" | "in-progress" | "done" | "blocked" | "cancelled";
export type TaskPriority = "p0" | "p1" | "p2";
export type TaskType = "bug" | "feat" | "refactor" | "test" | "docs";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  dependsOn: string[];
  created: string;
  updated: string;
  githubIssue?: number;    // GitHub issue number (set after sync)
  githubPR?: number;       // GitHub PR number (set after linking)
}
