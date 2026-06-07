import { UnifiedChatRequest } from "../types/llm";
import { Transformer } from "../types/transformer";

const GLM_THINKING_MODELS = ['glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7'];
const GLM_CODING_PLAN_MODELS = ['glm-5.1', 'glm-5'];

function isGlmThinkingModel(model: string): boolean {
  return GLM_THINKING_MODELS.some(m => model.startsWith(m));
}

function isGlmCodingPlanModel(model: string): boolean {
  return GLM_CODING_PLAN_MODELS.some(m => model === m || model.startsWith(m + '-'));
}

export class GlmTransformer implements Transformer {
  name = "glm";

  async transformRequestIn(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    const model = request.model || '';

    // Echo prior thinking as reasoning_content for multi-turn reasoning context
    // GLM models with clear_thinking: false retain reasoning across turns
    if (isGlmThinkingModel(model) && request.messages) {
      for (const msg of request.messages) {
        if (msg.role === 'assistant' && msg.thinking?.content) {
          (msg as any).reasoning_content = msg.thinking.content;
        }
      }
    }

    if (request.max_tokens && request.max_tokens > 128000) {
      request.max_tokens = 128000;
    }

    if (request.stream && request.tools && request.tools.length > 0) {
      (request as any).tool_stream = true;
    }

    if (isGlmThinkingModel(model)) {
      if (request.reasoning?.enabled !== false && !(request as any).thinking) {
        const thinkConfig: any = { type: 'enabled' };

        if (isGlmCodingPlanModel(model)) {
          thinkConfig.clear_thinking = false;
        }

        (request as any).thinking = thinkConfig;
      } else if ((request as any).thinking?.type === 'enabled') {
        if (isGlmCodingPlanModel(model)) {
          (request as any).thinking.clear_thinking = false;
        }
      }

      if (request.temperature === undefined && request.reasoning?.enabled !== false) {
        (request as any).temperature = 1.0;
        (request as any).do_sample = true;
      }

      delete request.reasoning;
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
          // reasoning-only response - no content to forward
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
      const logger = this.logger;

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
                  logger?.error("Error processing line:", line, error);
                  controller.enqueue(encoder.encode(line + "\n"));
                }
              }
            }
          } catch (error) {
            logger?.error("Stream error:", error);
            controller.error(error);
          } finally {
            try {
              reader.releaseLock();
            } catch (e) {
              logger?.error("Error releasing reader lock:", e);
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
