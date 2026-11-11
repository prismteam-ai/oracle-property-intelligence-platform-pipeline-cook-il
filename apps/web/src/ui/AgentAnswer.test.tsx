import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentAnswer } from "./AgentAnswer.js";

describe("AgentAnswer", () => {
  it("renders headers, rows, escaped pipes and surrounding evidence text", () => {
    const html = renderToStaticMarkup(
      <AgentAnswer
        text={"Evidence:\n| PIN | Address |\n| --- | :---: |\n| 123 | A\\|B |\n\nSources follow."}
      />,
    );
    expect(html).toContain('<table aria-label="Agent results">');
    expect(html).toContain('<th scope="col">PIN</th>');
    expect(html).toContain("<td>A|B</td>");
    expect(html).toContain("Evidence:");
    expect(html).toContain("Sources follow.");
  });
  it("keeps source URL pipes inside their cell and makes safe citations clickable", () => {
    const html = renderToStaticMarkup(
      <AgentAnswer
        text={"| PIN | Source |\n| --- | --- |\n| 123 | [record](https://example.org/?123|2026) |"}
      />,
    );
    expect(html).toContain("<td>123</td>");
    expect(html).toContain('href="https://example.org/?123|2026"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">record</a>");
  });
  it("does not interpret malformed tables or model HTML as executable content", () => {
    const html = renderToStaticMarkup(
      <AgentAnswer text={"| a | b |\n| -- |\n<script>alert(1)</script>"} />,
    );
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
