/**
 * model.ts - the two ways Chad talks to OpenAI.
 *
 * extract() is the logger: forced function use, so the answer is a validated
 * object rather than prose containing JSON.
 * write() is the coach: free text, called only when there is a reason.
 */

import OpenAI from 'openai';
import { need } from './env';
import type { ToolSpec } from './schema';

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) {
    // The whole turn must fit inside Vercel's function time limit.
    client = new OpenAI({
      apiKey: need('OPENAI_API_KEY'),
      maxRetries: 1,
      timeout: 25_000,
    });
  }
  return client;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string };

export function imageBlock(bytes: Uint8Array, mediaType: string): ContentBlock {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const type = allowed.includes(mediaType) ? mediaType : 'image/jpeg';
  return {
    type: 'image',
    dataUrl: `data:${type};base64,${Buffer.from(bytes).toString('base64')}`,
  };
}

function inputContent(
  content: ContentBlock[],
): OpenAI.Responses.ResponseInputContent[] {
  return content.map((block) =>
    block.type === 'text'
      ? { type: 'input_text', text: block.text }
      : {
          type: 'input_image',
          image_url: block.dataUrl,
          detail: 'auto',
        },
  );
}

/** One turn with forced function use. Returns the function arguments. */
export async function extract<T>(opts: {
  model: string;
  system: string;
  content: ContentBlock[];
  tool: ToolSpec;
  maxTokens?: number;
}): Promise<T> {
  const res = await openai().responses.create({
    model: opts.model,
    max_output_tokens: opts.maxTokens ?? 2500,
    instructions: opts.system,
    input: [{ role: 'user', content: inputContent(opts.content) }],
    tools: [
      {
        type: 'function',
        name: opts.tool.name,
        description: opts.tool.description,
        parameters: opts.tool.input_schema,
        strict: false,
      },
    ],
    tool_choice: { type: 'function', name: opts.tool.name },
    parallel_tool_calls: false,
    store: false,
  });

  const call = res.output.find((item) => item.type === 'function_call');
  if (!call || call.type !== 'function_call') {
    throw new Error('model answered without a function_call item');
  }

  return JSON.parse(call.arguments) as T;
}

/** Free text, for coaching. Returns the plain string the model wrote. */
export async function write(opts: {
  model: string;
  system: string;
  content: ContentBlock[];
  maxTokens?: number;
}): Promise<string> {
  const res = await openai().responses.create({
    model: opts.model,
    max_output_tokens: opts.maxTokens ?? 1000,
    instructions: opts.system,
    input: [{ role: 'user', content: inputContent(opts.content) }],
    store: false,
  });

  return res.output_text.trim();
}