// Deploy-file contract tests.
//
// These pin the invariants the deployment audit established, so a later edit
// cannot silently undo one. Every assertion here corresponds to a defect that
// actually shipped at least once:
//
//   - MODELHUB_ADMIN_PATH did not work in Docker (no ARG, no build arg).
//   - DATABASE_URL could drift from POSTGRES_PASSWORD.
//   - Logs had no rotation, so a chatty container grows without bound.
//   - .agents/.hermes rode into the build context (49MB+).
//
// Deploy files are code; these are their tests.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

type ComposeService = {
  build: { args: Record<string, string> };
  environment: Record<string, string>;
  logging: { options: Record<string, string> };
  ports: string[];
  security_opt: string[];
};
const compose = load(read("docker-compose.yml")) as {
  services: Record<string, ComposeService>;
};
// The app service must carry all four; if a section is missing the tests
// below should fail on the assertion, not on an undefined read.
const app = compose.services.modelhub;

const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");

describe("Dockerfile", () => {
  it("keeps the base image overridable from before the first FROM", () => {
    // A restricted network must be able to point at a mirror; an ARG declared
    // after the first FROM cannot resolve a later FROM's base.
    const argIdx = dockerfile.indexOf("ARG NODE_IMAGE");
    const firstFrom = dockerfile.indexOf("\nFROM ");
    expect(argIdx).toBeGreaterThan(-1);
    expect(argIdx).toBeLessThan(firstFrom);
  });

  it("uses the base-image ARG in every FROM", () => {
    const froms = dockerfile.match(/^FROM .+$/gm) ?? [];
    expect(froms.length).toBeGreaterThan(0);
    for (const line of froms) {
      expect(line).toContain("${NODE_IMAGE}");
    }
  });

  it("carries no BuildKit-only syntax directive", () => {
    // The directive forces a Docker Hub pull as the build's first step; this
    // host cannot reach it. The Dockerfile uses no heredoc/--mount/--link, so
    // the directive would be pure liability.
    expect(dockerfile).not.toMatch(/^#\s*syntax=/m);
    expect(dockerfile).not.toMatch(/<<\s*EOF|--mount=|--link/);
  });

  it("accepts MODELHUB_ADMIN_PATH as a build ARG", () => {
    // Next bakes the rewrite during `next build`; a runtime env var is inert.
    expect(dockerfile).toMatch(/^ARG MODELHUB_ADMIN_PATH$/m);
  });

  it("runs a healthcheck against the auth-exempt endpoint", () => {
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/api/health");
  });
});

describe("docker-compose.yml", () => {
  it("passes both build args the Dockerfile declares", () => {
    const args = app.build?.args ?? {};
    expect(args).toHaveProperty("MODELHUB_ADMIN_PATH");
    expect(args).toHaveProperty("NODE_IMAGE");
  });

  it("interpolates the postgres password into DATABASE_URL", () => {
    // Hardcoding it once let `POSTGRES_PASSWORD=x` produce a first-run auth
    // failure with no obvious cause.
    const url = app.environment?.DATABASE_URL ?? "";
    expect(url).toContain("${POSTGRES_PASSWORD");
    expect(url).toContain("${DATABASE_URL:-");
  });

  it("caps container logs", () => {
    for (const [name, svc] of Object.entries(compose.services)) {
      const opts = svc.logging?.options ?? {};
      expect(opts["max-size"], `${name}: max-size`).toBeTruthy();
      expect(opts["max-file"], `${name}: max-file`).toBeTruthy();
    }
  });

  it("forwards the SSRF escape hatch and fetch tuning", () => {
    const env = app.environment ?? {};
    for (const key of [
      "MODELHUB_ALLOW_PRIVATE_FETCH",
      "MODELHUB_FETCH_TIMEOUT_MS",
      "MODELHUB_FETCH_RETRIES",
      "MODELHUB_REFRESH_CONCURRENCY",
    ]) {
      expect(env, `${key} must reach the container`).toHaveProperty(key);
    }
    // Default must stay closed: opening it turns the app into an SSRF channel.
    expect(env.MODELHUB_ALLOW_PRIVATE_FETCH).toContain(":-false");
  });

  it("binds the app to loopback only", () => {
    for (const port of compose.services.modelhub.ports) {
      expect(port).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it("requires the secrets rather than defaulting them", () => {
    const env = app.environment ?? {};
    expect(env.MODELHUB_MASTER_KEY).toContain(":?");
    expect(env.MODELHUB_ADMIN_PASSWORD).toContain(":?");
  });

  it("forbids privilege escalation", () => {
    // The entrypoint starts as root to chown the data volume then drops to
    // uid 1001; no-new-privileges keeps it from climbing back.
    expect(app.security_opt ?? []).toContain("no-new-privileges:true");
  });
});

describe(".dockerignore", () => {
  it("excludes agent tooling trees and local data", () => {
    // .agents alone was 49MB of the ~98MB context.
    for (const entry of [".agents", ".hermes", "skills-lock.json", "data", ".env"]) {
      expect(dockerignore.split("\n"), `${entry} must be ignored`).toContain(entry);
    }
  });

  it("keeps the example env template in the context", () => {
    expect(dockerignore).toContain("!.env.example");
  });
});

describe(".gitignore", () => {
  it("keeps agent tooling, local scratch and generated files out of git", () => {
    // Each entry was a perpetually-untracked item polluting `git status`:
    // the agent skill trees, their installer lockfile, local debug scripts,
    // and the Next-managed next-env.d.ts (Next 16 docs: untrack it; it is
    // regenerated by next dev/build/typegen).
    const lines = read(".gitignore").split("\n");
    for (const entry of [
      ".agents/",
      ".hermes/",
      "skills-lock.json",
      "scratch/",
      "next-env.d.ts",
      "data/",
      "data-test/",
    ]) {
      expect(lines, `${entry} must be ignored`).toContain(entry);
    }
  });

  it("ignores env files but never the example template", () => {
    // A bare `.env.*` without the negation would hide .env.example too —
    // the one env file the repo must ship.
    const lines = read(".gitignore").split("\n");
    expect(lines).toContain(".env");
    expect(lines).toContain(".env.*");
    expect(lines).toContain("!.env.example");
  });
});

describe("Docker entrypoint", () => {
  it("drops privileges to the runtime user", () => {
    const entry = read("docker-entrypoint.sh");
    expect(entry).toMatch(/su-exec|gosu|setpriv/);
    expect(entry).toMatch(/1001|nextjs/);
  });
});

describe("deploy file inventory", () => {
  it("has no stray compose or Dockerfile variants left unhardened", () => {
    const files = readdirSync(ROOT);
    const composeFiles = files.filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
    expect(composeFiles).toEqual(["docker-compose.yml"]);
    const dockerfiles = files.filter((f) => /^Dockerfile/.test(f));
    expect(dockerfiles).toEqual(["Dockerfile"]);
    expect(existsSync(join(ROOT, ".env.example"))).toBe(true);
  });
});
