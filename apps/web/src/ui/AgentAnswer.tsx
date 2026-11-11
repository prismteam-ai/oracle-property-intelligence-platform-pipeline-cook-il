function InlineText({ text }: { text: string }) {
  const parts = [];
  let start = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    const index = match.index ?? 0;
    parts.push(text.slice(start, index));
    parts.push(
      <a key={index} href={match[2]} target="_blank" rel="noopener noreferrer">
        {match[1]}
      </a>,
    );
    start = index + match[0].length;
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}

/** Render structured agent tables as accessible HTML; all model text stays React-escaped. */
export function AgentAnswer({ text }: { text: string }) {
  const lines = text.split("\n");
  const cells = (line: string) =>
    line
      .replace(/\[[^\]]*\]\([^)]*\)/g, (link) => link.replace(/\|/g, "\\|"))
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((s) => s.trim().replace(/\\\|/g, "|"));
  const blocks = [];
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const header = cells(lines[i] ?? "");
    const divider = cells(lines[i + 1] ?? "");
    if (
      header.length < 2 ||
      divider.length !== header.length ||
      !divider.every((s) => /^:?-{3,}:?$/.test(s))
    )
      continue;
    if (i > start)
      blocks.push(
        <div key={`text-${start}`}>
          <InlineText text={lines.slice(start, i).join("\n")} />
        </div>,
      );
    const rows: string[][] = [];
    let end = i + 2;
    while (end < lines.length && lines[end]?.includes("|")) {
      const row = cells(lines[end]!);
      if (row.length !== header.length) break;
      rows.push(row);
      end++;
    }
    blocks.push(
      <div key={`table-${i}`} style={{ overflowX: "auto", whiteSpace: "normal", maxWidth: "100%" }}>
        <table aria-label="Agent results">
          <thead>
            <tr>
              {header.map((cell, n) => (
                <th scope="col" key={n}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, n) => (
              <tr key={n}>
                {row.map((cell, m) => (
                  <td key={m}>
                    <InlineText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    start = end;
    i = end - 1;
  }
  if (start < lines.length)
    blocks.push(
      <div key={`text-${start}`}>
        <InlineText text={lines.slice(start).join("\n")} />
      </div>,
    );
  return <>{blocks}</>;
}
