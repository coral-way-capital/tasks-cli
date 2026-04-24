import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, saveConfig, isGithubEnabled, ensureGithubPrerequisites } from "../src/lib/config";
import type { TasksConfig } from "../src/lib/config";

const TEST_DIR = join("/tmp", `.tasks-test-config-${process.pid}`);
let origDir: string;

beforeEach(() => {
  origDir = process.cwd();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
});

afterEach(() => {
  process.chdir(origDir);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

const configPath = () => join(TEST_DIR, ".tasks", "config.json");

describe("loadConfig", () => {
  it("returns empty object when no config file exists", () => {
    expect(loadConfig()).toEqual({});
  });

  it("returns parsed config when file exists", () => {
    mkdirSync(join(TEST_DIR, ".tasks"), { recursive: true });
    const config: TasksConfig = { github: { enabled: true, labels: ["task"] } };
    writeFileSync(configPath(), JSON.stringify(config), "utf-8");

    expect(loadConfig()).toEqual(config);
  });

  it("returns empty object for empty file", () => {
    mkdirSync(join(TEST_DIR, ".tasks"), { recursive: true });
    writeFileSync(configPath(), "{}", "utf-8");

    expect(loadConfig()).toEqual({});
  });

  it("throws meaningful error for invalid JSON", () => {
    mkdirSync(join(TEST_DIR, ".tasks"), { recursive: true });
    writeFileSync(configPath(), "not json", "utf-8");

    expect(() => loadConfig()).toThrow(/Failed to parse/);
  });
});

describe("saveConfig", () => {
  it("creates .tasks/ directory and writes config", () => {
    const config: TasksConfig = { github: { enabled: true } };
    saveConfig(config);

    expect(existsSync(configPath())).toBe(true);
    expect(loadConfig()).toEqual(config);
  });

  it("writes pretty-printed JSON", () => {
    const config: TasksConfig = { github: { enabled: true, labels: ["task"] } };
    saveConfig(config);

    const content = readFileSync(configPath(), "utf-8");
    expect(content).toContain("\n");
    expect(content).toContain("  "); // indented with 2 spaces
  });

  it("overwrites existing config", () => {
    saveConfig({ github: { enabled: true } });
    const second: TasksConfig = { github: { enabled: false, labels: ["bug"] } };
    saveConfig(second);

    expect(loadConfig()).toEqual(second);
  });
});

describe("isGithubEnabled", () => {
  it("returns false when no config file", () => {
    expect(isGithubEnabled()).toBe(false);
  });

  it("returns false when github not set", () => {
    saveConfig({});
    expect(isGithubEnabled()).toBe(false);
  });

  it("returns false when github.enabled is false", () => {
    saveConfig({ github: { enabled: false } });
    expect(isGithubEnabled()).toBe(false);
  });

  it("returns true when github.enabled is true", () => {
    saveConfig({ github: { enabled: true } });
    expect(isGithubEnabled()).toBe(true);
  });
});

describe("ensureGithubPrerequisites", () => {
  it("returns error string when not in a GitHub repo", () => {
    const result = ensureGithubPrerequisites();
    expect(typeof result).toBe("string");
  });

  // TODO: "returns object with owner and repo when in GitHub repo"
  // Cannot easily set up a git repo with GitHub remote in /tmp.
});
