/**
 * claude.ts - the two ways Arnold talks to a model.
 *
 * extract() is the logger: forced tool use, so the answer is a validated object
 * and never prose with a JSON block somewhere inside it.
 * write() is the coach: free text, called only when there is an actual reason.
 *
 * Two jobs, two models (see arnold.config.ts): logging has to be finished in
 * seconds or nobody keeps using it, coaching is allowed to think.
 */

import Anthropic from '@anthropic-ai/sdk';
import { need } from './env';
import type { ToolSpec } from './schema';

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: need('ANTHROPIC_API_KEY'),
      maxRetries: 2,
      timeout: 45_000,
    });
  }
  return client;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export function imageBlock(bytes: Uint8Array, mediaType: string): ContentBlock {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const type = allowed.includes(mediaType) ? mediaType : 'image/jpeg';
  return {
    type: 'image',
    source: { type: 'base64', media_type: type, data: Buffer.from(bytes).toString('base64') },
  };
}

/** One turn with forced tool use. Returns the validated tool input. */
export async function extract<T>(opts: {
  model: string;
  system: string;
  content: ContentBlock[];
  tool: ToolSpec;
  maxTokens?: number;
}): Promise<T> {
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2000,
    system: opts.system,
    tools: [{
      name: opts.tool.name,
      description: opts.tool.description,
      input_schema: opts.tool.input_schema as Anthropic.Tool.InputSchema,
    }],
    tool_choice: { type: 'tool', name: opts.tool.name },
    messages: [{ role: 'user', content: opts.content as Anthropic.ContentBlockParam[] }],
  });

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error('model answered without a tool_use block');
  }
  return block.input as T;
}

/** Free text, for coaching. Returns the plain string the model wrote. */
export async function write(opts: {
  model: string;
  system: string;
  content: ContentBlock[];
  maxTokens?: number;
}): Promise<string> {
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.content as Anthropic.ContentBlockParam[] }],
  });
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim();
}
