/**
 * classify.ts - message in, structured entry out.
 *
 * One model call with everything it needs to be right the first time: the
 * standing assumptions, the named templates, what is already logged today and
 * yesterday (with ids, which doubles as the address book for corrections), the
 * last few turns of conversation, and any open follow-up question.
 *
 * That context is not a nicety. Without "already logged" a recap message books
 * breakfast twice; without the ids a correction cannot address anything;
 * without the templates "my usual breakfast" gets re-estimated to a different
 * number every single morning.
 */

import { extract, imageBlock, type ContentBlock } from './claude';
import { buildTool, type ClassifyResult } from './schema';
import {
  assumptionContext, conversationContext, languageInstruction, loggedContext,
  pendingContext, systemPrompt, templateContext,
} from './prompt';
import type { ArnoldConfig } from './config-types';
import type { AssumptionRow, DayData, MessageRow, PendingRow, TemplateRow } from './db';

export interface ClassifyContext {
  config: ArnoldConfig;
  today: DayData;
  yesterday: DayData;
  templates: TemplateRow[];
  assumptions: AssumptionRow[];
  history: MessageRow[];
  pending: PendingRow | null;
}

export async function classify(opts: {
  text: string;
  image?: { bytes: Uint8Array; mediaType: string } | null;
  context: ClassifyContext;
  now?: Date;
}): Promise<ClassifyResult> {
  const { context: ctx } = opts;
  const c = ctx.config;

  const system = [
    systemPrompt(c, opts.now),
    languageInstruction(c.language),
    templateContext(ctx.templates),
    assumptionContext(ctx.assumptions),
    loggedContext(ctx.today, ctx.yesterday, c),
  ].join('\n');

  const content: ContentBlock[] = [];
  if (opts.image) content.push(imageBlock(opts.image.bytes, opts.image.mediaType));

  const parts: string[] = [];
  const history = conversationContext(ctx.history);
  if (history) parts.push(history);
  if (ctx.pending) parts.push(pendingContext(ctx.pending.question, ctx.pending.subject));
  parts.push(opts.text ? `Message: ${opts.text}` : 'Message: (photo with no text)');

  content.push({ type: 'text', text: parts.join('\n\n') });

  return extract<ClassifyResult>({
    model: c.models.classify,
    system,
    content,
    tool: buildTool(c),
    maxTokens: 2500,
  });
}

/**
 * Did the model actually ask for something to happen?
 *
 * Corrections and assumptions count as an action even when is_entry comes back
 * false, because a model that is told "this is not an entry, it is a fix" tends
 * to answer both ways. Without this, "delete the duplicate" would fall through
 * to the conversational branch, which cannot write to the database.
 */
export function hasAction(r: ClassifyResult | null | undefined): boolean {
  if (!r) return false;
  return r.is_entry === true
    || (r.corrections?.length ?? 0) > 0
    || Boolean(r.remember_assumption?.keyword)
    || Boolean(r.define_template?.name)
    || (r.use_template?.length ?? 0) > 0
    || Boolean(r.settings_update && Object.keys(r.settings_update).length);
}
