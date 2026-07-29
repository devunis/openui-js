import assert from "node:assert/strict";
import test from "node:test";

import { OpenUIClient, OpenUIError, parseEventStream } from "../src/index.js";

function streamFrom(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

test("parseEventStream handles split chunks and metadata", async () => {
  const events = [];
  for await (const event of parseEventStream(
    streamFrom([
      'data: {"openui":{"sources":[{"title":"Docs"}]}}\n',
      '\ndata: {"choices":[{"delta":{"content":"hel',
      'lo"}}]}\n\ndata: [DONE]\n\n'
    ])
  )) {
    events.push(event);
  }
  assert.equal(events[0].openui.sources[0].title, "Docs");
  assert.equal(events[1].choices[0].delta.content, "hello");
});

test("OpenUIClient streams text and reports sources/tools", async () => {
  const sources = [];
  const toolEvents = [];
  const client = new OpenUIClient({
    fetch: async () =>
      new Response(
        streamFrom([
          'data: {"openui":{"sources":[{"title":"Docs"}],"toolEvents":[{"name":"calculator"}]}}\n\n',
          'data: {"choices":[{"delta":{"content":"42"}}]}\n\n',
          "data: [DONE]\n\n"
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
  });
  let content = "";
  for await (const delta of client.streamChat(
    { model: "test", messages: [{ role: "user", content: "hi" }] },
    {
      onSources: (items) => sources.push(...items),
      onTools: (items) => toolEvents.push(...items)
    }
  )) {
    content += delta;
  }
  assert.equal(content, "42");
  assert.equal(sources[0].title, "Docs");
  assert.equal(toolEvents[0].name, "calculator");
});

test("OpenUIClient normalizes API errors", async () => {
  const client = new OpenUIClient({
    fetch: async () =>
      new Response(JSON.stringify({ detail: "Nope" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      })
  });
  await assert.rejects(client.config(), (error) => {
    assert.ok(error instanceof OpenUIError);
    assert.equal(error.status, 403);
    assert.equal(error.message, "Nope");
    return true;
  });
});
