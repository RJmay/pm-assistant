import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index";

describe("@pm/shared", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@pm/shared");
  });
});
