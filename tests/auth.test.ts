import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTokenStore } from "../src/auth.js";

const paths: string[] = [];

afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("local token storage", () => {
  it("encrypts OAuth tokens at rest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "google-workspace-mcp-"));
    paths.push(directory);
    const file = join(directory, "tokens.json");
    const store = new LocalTokenStore(file, randomBytes(32));
    await store.save({ refresh_token: "not-plaintext" });
    expect(await readFile(file, "utf8")).not.toContain("not-plaintext");
    await expect(store.load()).resolves.toEqual({ refresh_token: "not-plaintext" });
  });
});