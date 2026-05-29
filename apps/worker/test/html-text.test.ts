import { describe, expect, it } from "vitest";
import { extractText } from "../src/services/monitoring/html-text";

describe("extractText", () => {
  it("strips tags and collapses whitespace", () => {
    expect(extractText("<h1>Entry  notice</h1>\n<p>7 days</p>")).toBe("Entry notice 7 days");
  });

  it("drops script and style content", () => {
    const html = "<style>.x{color:red}</style><p>Keep this</p><script>alert(1)</script>";
    expect(extractText(html)).toBe("Keep this");
  });

  it("decodes common entities", () => {
    expect(extractText("<p>Tenant &amp; lessor &mdash; 7&nbsp;days</p>")).toBe(
      "Tenant & lessor — 7 days",
    );
  });
});
