import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { solveAcwCookieValue, ACW_COOKIE_NAME } from "@/lib/infra/acwChallenge";

const ROOT = new URL("..", import.meta.url).pathname;
const fixture = (name: string) =>
  readFileSync(join(ROOT, "tests/fixtures", name), "utf8");

/**
 * The fixtures are real challenge pages captured from anyrouter.top (an ESA
 * "http_custom" anti-bot page). Ground truth: executing each captured page's
 * own script (in a VM) computes the cookie below; fixture 1's cookie was
 * additionally round-tripped against the live site — sent back, it returns
 * the real /api/status JSON instead of the challenge.
 */
describe("solveAcwCookieValue", () => {
  it("computes the cookie for real captured challenge pages", () => {
    expect(solveAcwCookieValue(fixture("acw-challenge-1.html"))).toBe(
      "6ac21bd3de4e480b2df6aefeeab09f2aedea0666"
    );
    expect(solveAcwCookieValue(fixture("acw-challenge-2.html"))).toBe(
      "6ac21ff6af1afc0fb4be2d1b937cf5a21071a83e"
    );
  });

  it("returns null when the body is not an acw challenge", () => {
    expect(
      solveAcwCookieValue('{"data":{"system_name":"Cat API"}}')
    ).toBeNull();
    expect(
      solveAcwCookieValue("<!doctype html><html><body>SPA shell</body></html>")
    ).toBeNull();
    expect(solveAcwCookieValue("")).toBeNull();
  });

  it("uses the acw_sc__v2 cookie name the challenge sets", () => {
    expect(ACW_COOKIE_NAME).toBe("acw_sc__v2");
  });
});
