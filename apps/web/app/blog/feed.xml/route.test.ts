import { GET } from "./route";

describe("GET /blog/feed.xml", () => {
  it("serves the RSS feed with the RSS content type", () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/rss+xml; charset=utf-8",
    );

    // jest.setup.js swaps in a minimal Response that keeps the raw body string.
    const body = String((response as unknown as { body: string }).body);
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain(
      '<atom:link href="https://cahootzcommons.com/blog/feed.xml" rel="self" type="application/rss+xml" />',
    );
  });
});
