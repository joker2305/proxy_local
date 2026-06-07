import type { SSEEvent } from "./sse-collector";

export class SSEReplayer {
  static replayOpenAI(cached: any): ReadableStream {
    const chunks: string[] = [];
    const id = cached.id || `chatcmpl-${Date.now()}`;
    const model = cached.model || "unknown";
    const message = cached.choices?.[0]?.message;

    if (message?.content) {
      const textChunks = splitIntoChunks(message.content, 20);
      for (const chunk of textChunks) {
        chunks.push(
          formatSSE({
            data: {
              id,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: chunk },
                  finish_reason: null,
                },
              ],
            },
          })
        );
      }
    }

    if (message?.tool_calls) {
      for (let i = 0; i < message.tool_calls.length; i++) {
        const tc = message.tool_calls[i];
        chunks.push(
          formatSSE({
            data: {
              id,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: i,
                        id: tc.id,
                        type: tc.type || "function",
                        function: {
                          name: tc.function?.name || "",
                          arguments: "",
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
          })
        );

        if (tc.function?.arguments) {
          const argChunks = splitIntoChunks(tc.function.arguments, 20);
          for (const ac of argChunks) {
            chunks.push(
              formatSSE({
                data: {
                  id,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: i,
                            function: { arguments: ac },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                },
              })
            );
          }
        }
      }
    }

    chunks.push(
      formatSSE({
        data: {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: cached.choices?.[0]?.finish_reason || "stop",
            },
          ],
        },
      })
    );

    if (cached.usage) {
      chunks.push(
        formatSSE({
          data: {
            id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [],
            usage: cached.usage,
          },
        })
      );
    }

    chunks.push(formatSSE({ data: { type: "done" } }));

    return createChunkedStream(chunks);
  }

  static replayAnthropic(cached: any): ReadableStream {
    const chunks: string[] = [];
    const model = cached.model || "unknown";
    const content = cached.content || [];

    chunks.push(
      formatSSE(
        {
          type: "message_start",
          message: {
            id: cached.id || `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: cached.usage?.input_tokens || 0,
              output_tokens: 0,
            },
          },
        },
        "message_start"
      )
    );

    for (let i = 0; i < content.length; i++) {
      const block = content[i];

      if (block.type === "thinking") {
        chunks.push(
          formatSSE(
            {
              type: "content_block_start",
              index: i,
              content_block: {
                type: "thinking",
                thinking: "",
              },
            },
            "content_block_start"
          )
        );

        if (block.thinking) {
          const thinkingChunks = splitIntoChunks(block.thinking, 20);
          for (const tc of thinkingChunks) {
            chunks.push(
              formatSSE(
                {
                  type: "content_block_delta",
                  index: i,
                  delta: { type: "thinking_delta", thinking: tc },
                },
                "content_block_delta"
              )
            );
          }
        }

        if (block.signature) {
          chunks.push(
            formatSSE(
              {
                type: "content_block_delta",
                index: i,
                delta: { type: "signature_delta", signature: block.signature },
              },
              "content_block_delta"
            )
          );
        }

        chunks.push(
          formatSSE(
            { type: "content_block_stop", index: i },
            "content_block_stop"
          )
        );
      } else if (block.type === "text") {
        chunks.push(
          formatSSE(
            {
              type: "content_block_start",
              index: i,
              content_block: { type: "text", text: "" },
            },
            "content_block_start"
          )
        );

        if (block.text) {
          const textChunks = splitIntoChunks(block.text, 20);
          for (const tc of textChunks) {
            chunks.push(
              formatSSE(
                {
                  type: "content_block_delta",
                  index: i,
                  delta: { type: "text_delta", text: tc },
                },
                "content_block_delta"
              )
            );
          }
        }

        chunks.push(
          formatSSE(
            { type: "content_block_stop", index: i },
            "content_block_stop"
          )
        );
      } else if (block.type === "tool_use") {
        chunks.push(
          formatSSE(
            {
              type: "content_block_start",
              index: i,
              content_block: {
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: {},
              },
            },
            "content_block_start"
          )
        );

        const inputJson = JSON.stringify(block.input || {});
        const jsonChunks = splitIntoChunks(inputJson, 20);
        for (const jc of jsonChunks) {
          chunks.push(
            formatSSE(
              {
                type: "content_block_delta",
                index: i,
                delta: {
                  type: "input_json_delta",
                  partial_json: jc,
                },
              },
              "content_block_delta"
            )
          );
        }

        chunks.push(
          formatSSE(
            { type: "content_block_stop", index: i },
            "content_block_stop"
          )
        );
      }
    }

    chunks.push(
      formatSSE(
        {
          type: "message_delta",
          delta: {
            stop_reason: cached.stop_reason || "end_turn",
            stop_sequence: cached.stop_sequence || null,
          },
          usage: {
            output_tokens: cached.usage?.output_tokens || 0,
          },
        },
        "message_delta"
      )
    );

    chunks.push(
      formatSSE({ type: "message_stop" }, "message_stop")
    );

    return createChunkedStream(chunks);
  }

  static replay(
    cached: any,
    format: "openai" | "anthropic" | "unknown"
  ): ReadableStream {
    if (format === "openai") return this.replayOpenAI(cached);
    if (format === "anthropic") return this.replayAnthropic(cached);
    return new ReadableStream({
      start(controller) {
        controller.error(new Error("Unknown SSE format for replay"));
      },
    });
  }
}

function formatSSE(data: any, event?: string): string {
  let output = "";
  if (event) {
    output += `event: ${event}\n`;
  }
  if (data.type === "done") {
    output += "data: [DONE]\n";
  } else {
    output += `data: ${JSON.stringify(data)}\n`;
  }
  output += "\n";
  return output;
}

function splitIntoChunks(text: string, chunkSize: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function createChunkedStream(sseChunks: string[]): ReadableStream {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < sseChunks.length) {
        controller.enqueue(encoder.encode(sseChunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}
