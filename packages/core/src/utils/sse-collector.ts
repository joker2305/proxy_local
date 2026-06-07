import { createHash } from "crypto";

export interface CollectedSSE {
  rawChunks: string[];
  events: SSEEvent[];
  completeResponse: any;
  format: "openai" | "anthropic" | "unknown";
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface SSEEvent {
  event?: string;
  data: any;
  id?: string;
}

export class SSECollector {
  private chunks: string[] = [];
  private events: SSEEvent[] = [];
  private decoder = new TextDecoder();
  private buffer = "";

  push(rawChunk: Uint8Array | string): void {
    const text =
      typeof rawChunk === "string"
        ? rawChunk
        : this.decoder.decode(rawChunk, { stream: true });
    this.chunks.push(text);
    this.parseEvents(text);
  }

  finalize(): CollectedSSE {
    const format = this.detectFormat();
    const completeResponse = this.reassemble(format);
    return {
      rawChunks: this.chunks,
      events: this.events,
      completeResponse,
      format,
      model: completeResponse?.model || "",
      usage: this.extractUsage(format, completeResponse),
    };
  }

  private parseEvents(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    let currentEvent: SSEEvent | null = null;

    for (const line of lines) {
      if (!line.trim()) {
        if (currentEvent && currentEvent.data !== undefined) {
          this.events.push(currentEvent);
        }
        currentEvent = null;
        continue;
      }

      if (!currentEvent) currentEvent = { data: null as any };

      if (line.startsWith("event:")) {
        currentEvent.event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          currentEvent.data = { type: "done" };
        } else {
          try {
            currentEvent.data = JSON.parse(data);
          } catch {
            currentEvent.data = { raw: data };
          }
        }
      } else if (line.startsWith("id:")) {
        currentEvent.id = line.slice(3).trim();
      }
    }
  }

  private detectFormat(): "openai" | "anthropic" | "unknown" {
    for (const evt of this.events) {
      if (evt.data?.type === "done") continue;
      if (
        evt.data?.object === "chat.completion.chunk" ||
        evt.data?.choices?.[0]?.delta !== undefined
      ) {
        return "openai";
      }
      if (
        evt.data?.type === "message_start" ||
        evt.data?.type === "content_block_start" ||
        evt.data?.type === "content_block_delta"
      ) {
        return "anthropic";
      }
    }
    return "unknown";
  }

  private reassemble(format: "openai" | "anthropic" | "unknown"): any {
    if (format === "openai") return this.reassembleOpenAI();
    if (format === "anthropic") return this.reassembleAnthropic();
    return null;
  }

  private reassembleOpenAI(): any {
    let id = "";
    let model = "";
    let content = "";
    let toolCalls: Array<{
      index: number;
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> = [];
    let usage: any = null;
    let finishReason: string | null = null;

    for (const evt of this.events) {
      const d = evt.data;
      if (!d || d.type === "done") continue;

      if (d.object === "chat.completion.chunk") {
        id = d.id || id;
        model = d.model || model;
        finishReason = d.choices?.[0]?.finish_reason ?? finishReason;

        const delta = d.choices?.[0]?.delta;
        if (delta) {
          if (delta.content) content += delta.content;
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  index: idx,
                  id: tc.id || "",
                  type: tc.type || "function",
                  function: { name: "", arguments: "" },
                };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name)
                toolCalls[idx].function.name = tc.function.name;
              if (tc.function?.arguments)
                toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        }
        if (d.usage) usage = d.usage;
      }
    }

    const message: any = {
      role: "assistant",
      content: content || null,
    };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    return {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason || "stop",
        },
      ],
      usage: usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  private reassembleAnthropic(): any {
    let message: any = null;
    let currentBlocks: any[] = [];

    for (const evt of this.events) {
      const d = evt.data;
      if (!d || d.type === "done") continue;

      if (d.type === "message_start" && d.message) {
        message = { ...d.message, content: [] };
      } else if (d.type === "content_block_start" && message) {
        const block = d.content_block ? { ...d.content_block } : {};
        currentBlocks[d.index] = block;
        if (message.content) message.content.push(block);
      } else if (d.type === "content_block_delta" && message) {
        const block = currentBlocks[d.index];
        if (!block) continue;
        const delta = d.delta;
        if (!delta) continue;

        if (delta.type === "text_delta")
          block.text = (block.text || "") + delta.text;
        else if (delta.type === "thinking_delta")
          block.thinking = (block.thinking || "") + delta.thinking;
        else if (delta.type === "signature_delta")
          block.signature = (block.signature || "") + delta.signature;
        else if (delta.type === "input_json_delta")
          block.partial_json = (block.partial_json || "") + delta.partial_json;
      } else if (d.type === "message_delta" && message) {
        if (d.delta?.stop_reason) message.stop_reason = d.delta.stop_reason;
        if (d.delta?.stop_sequence)
          message.stop_sequence = d.delta.stop_sequence;
        if (d.usage) message.usage = d.usage;
      }
    }

    if (message?.content) {
      for (const block of message.content) {
        if (block.partial_json !== undefined) {
          try {
            block.input = JSON.parse(block.partial_json);
          } catch {}
          delete block.partial_json;
        }
      }
    }

    return message;
  }

  private extractUsage(
    format: string,
    response: any
  ): { input_tokens: number; output_tokens: number } | undefined {
    if (!response) return undefined;
    if (format === "openai") {
      return {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      };
    }
    if (format === "anthropic" && response?.usage) {
      return {
        input_tokens: response.usage.input_tokens || 0,
        output_tokens: response.usage.output_tokens || 0,
      };
    }
    return undefined;
  }
}

export function generateStreamingCacheKey(body: any, model?: string): string {
  const messages = body.messages || [];
  const last5 = messages.slice(-5).map((m: any) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content.slice(0, 200)
        : "[complex]",
  }));

  const system =
    typeof body.system === "string"
      ? body.system.slice(0, 500)
      : Array.isArray(body.system)
        ? JSON.stringify(body.system).slice(0, 500)
        : "";

  const tools = (body.tools || [])
    .map((t: any) => t.name)
    .sort()
    .join(",");

  const normalized = JSON.stringify({
    model: model || body.model || "",
    messages: last5,
    system,
    tools,
  });

  return (
    "stream:" +
    createHash("sha256").update(normalized).digest("hex").slice(0, 24)
  );
}
