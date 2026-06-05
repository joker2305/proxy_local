import { UnifiedChatRequest } from "../types/llm";
import { Transformer } from "../types/transformer";

const DEEPSEEK_V4_PRO_MODELS = ['deepseek-v4-pro', 'deepseek-reasoner'];
const DEEPSEEK_V4_FLASH_MODELS = ['deepseek-v4-flash', 'deepseek-chat'];

function isDeepseekV4Pro(model: string): boolean {
  return DEEPSEEK_V4_PRO_MODELS.some(m => model.includes(m));
}

function isDeepseekV4Flash(model: string): boolean {
  return DEEPSEEK_V4_FLASH_MODELS.some(m => model.includes(m));
}

function isDeepseekThinkingModel(model: string): boolean {
  return isDeepseekV4Pro(model) || isDeepseekV4Flash(model);
}

export class DeepseekTransformer implements Transformer {
  name = "deepseek";

  async transformRequestIn(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    const model = request.model || '';

    if (isDeepseekV4Pro(model)) {
      if (request.max_tokens && request.max_tokens > 384000) {
        request.max_tokens = 384000;
      }

      if (request.reasoning?.enabled !== false) {
        (request as any).thinking = { type: 'enabled' };
        delete request.temperature;
        delete request.top_p;
        delete request.presence_penalty;
        delete request.frequency_penalty;

        const effort = (request as any).reasoning_effort
          || (request.reasoning?.max_tokens && request.reasoning.max_tokens > 32000 ? 'max' : undefined)
          || 'max';
        (request as any).reasoning_effort = effort;
      } else {
        (request as any).thinking = { type: 'disabled' };
      }

      delete request.reasoning;
    } else if (isDeepseekV4Flash(model)) {
      if (request.max_tokens && request.max_tokens > 384000) {
        request.max_tokens = 384000;
      }

      if (request.reasoning?.enabled) {
        (request as any).thinking = { type: 'enabled' };
        delete request.temperature;
        delete request.top_p;
        delete request.presence_penalty;
        delete request.frequency_penalty;
      } else if ((request as any).reasoning_effort) {
        (request as any).thinking = { type: 'enabled' };
        delete request.temperature;
        delete request.top_p;
      }

      delete request.reasoning;
    } else {
      if (request.max_tokens && request.max_tokens > 64000) {
        request.max_tokens = 64000;
      }
    }

    return request;
  }

  async transformResponseOut(response: Response, context?: any): Promise<Response> {
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const jsonResponse = await response.json();
      const msg = jsonResponse?.choices?.[0]?.message;

      if (!response.ok) {
        return new Response(JSON.stringify(jsonResponse), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      if (msg?.reasoning_content) {
        if (!msg.thinking) {
          msg.thinking = { content: msg.reasoning_content };
        }
        delete msg.reasoning_content;

        if (!msg.content || msg.content === "") {
          console.log(`[DeepseekTransformer] reasoning-only response (${msg.thinking.content.length} chars)`);
        }
      }

      return new Response(JSON.stringify(jsonResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } else if (response.headers.get("Content-Type")?.includes("stream")) {
      if (!response.body) {
        return response;
      }

      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader();

          const processLine = (
            line: string,
            controller: ReadableStreamDefaultController,
            encoder: TextEncoder
          ) => {
            if (
              line.startsWith("data: ") &&
              line.trim() !== "data: [DONE]"
            ) {
              try {
                const data = JSON.parse(line.slice(6));

                const hasReasoning = !!data.choices?.[0]?.delta?.reasoning_content;
                const hasContent = !!data.choices?.[0]?.delta?.content;

                if (hasReasoning) {
                  const thinkingChunk = {
                    ...data,
                    choices: [
                      {
                        ...data.choices[0],
                        delta: {
                          thinking: {
                            content: data.choices[0].delta.reasoning_content,
                          },
                        },
                      },
                    ],
                  };
                  const thinkingLine = `data: ${JSON.stringify(thinkingChunk)}\n\n`;
                  controller.enqueue(encoder.encode(thinkingLine));

                  if (hasContent) {
                    const contentChunk = {
                      ...data,
                      choices: [
                        {
                          ...data.choices[0],
                          delta: {
                            content: data.choices[0].delta.content,
                          },
                        },
                      ],
                    };
                    const contentLine = `data: ${JSON.stringify(contentChunk)}\n\n`;
                    controller.enqueue(encoder.encode(contentLine));
                  }
                  return;
                }

                if (
                  data.choices?.[0]?.delta &&
                  Object.keys(data.choices[0].delta).length > 0
                ) {
                  const modifiedLine = `data: ${JSON.stringify(data)}\n\n`;
                  controller.enqueue(encoder.encode(modifiedLine));
                }
              } catch (e) {
                controller.enqueue(encoder.encode(line + "\n"));
              }
            } else {
              controller.enqueue(encoder.encode(line + "\n"));
            }
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                if (buffer.trim()) {
                  processLine(buffer, controller, encoder);
                }
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;

              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) continue;

                try {
                  processLine(line, controller, encoder);
                } catch (error) {
                  console.error("Error processing line:", line, error);
                  controller.enqueue(encoder.encode(line + "\n"));
                }
              }
            }
          } catch (error) {
            console.error("Stream error:", error);
            controller.error(error);
          } finally {
            try {
              reader.releaseLock();
            } catch (e) {
              console.error("Error releasing reader lock:", e);
            }
            try { controller.close(); } catch {}
          }
        },
      });

      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "text/plain",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return response;
  }
}
