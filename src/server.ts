#!/usr/bin/env node
/**
 * MCP server exposing AI Tutor Card disclosures as tools.
 *
 * Tools:
 *   - tutor_card_well_known_url  : compute discovery URL
 *   - tutor_card_fetch           : fetch a card from any URL
 *   - tutor_card_validate        : schema-validate an inline JSON document
 *   - tutor_card_inspect         : structured procurement summary
 *   - tutor_card_subject_check   : does the tutor cover topic X?
 *   - tutor_card_coppa_check     : COPPA conditional-rule verification
 *
 * Drop into Claude Desktop, Cursor, or any MCP-compatible client via stdio.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  type TutorCard,
  checkCoppa,
  checkSubject,
  fetchTutorCard,
  parseTutorCard,
  tutorCardSchema,
  tutorWellKnownUrl,
} from "./document.js";
import { toolDescriptors } from "./tools.js";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function loadCard(args: { url?: string; document_json?: string }): Promise<TutorCard> {
  if (args.document_json) return parseTutorCard(args.document_json);
  if (args.url) return await fetchTutorCard(args.url);
  throw new Error("must provide either `url` or `document_json`");
}

export async function handleTutorCardWellKnownUrl(args: {
  origin: string;
  tutor_id: string;
}): Promise<string> {
  return pretty({ url: tutorWellKnownUrl(args.origin, args.tutor_id) });
}

export async function handleTutorCardFetch(args: { url: string }): Promise<string> {
  const card = await fetchTutorCard(args.url);
  return pretty(card);
}

export async function handleTutorCardValidate(args: { document_json: string }): Promise<string> {
  try {
    const card = parseTutorCard(args.document_json);
    return pretty({
      valid: true,
      tutor_id: card.tutor.id,
      version: card.tutor.version,
      coppa_check: checkCoppa(card),
    });
  } catch (err) {
    return pretty({
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleTutorCardInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadCard(args);
  return pretty({
    tutor_card_version: card.tutor_card_version,
    tutor: {
      id: card.tutor.id,
      name: card.tutor.name,
      version: card.tutor.version,
      provider: card.tutor.provider,
    },
    audience: {
      ages: `${card.audience.age_range_min}-${card.audience.age_range_max}`,
      grades: `${card.audience.grade_range_min}-${card.audience.grade_range_max}`,
      languages: card.audience.language_codes,
    },
    pedagogy: {
      approach: card.pedagogy.approach,
      homework_policy: card.pedagogy.homework_policy,
      assessment_policy: card.pedagogy.assessment_policy,
    },
    subject_scope: {
      primary: card.subject_scope.primary_subjects,
      includes: card.subject_scope.topics_included?.length ?? 0,
      excludes: card.subject_scope.topics_excluded?.length ?? 0,
    },
    safety: {
      content_filter_strength: card.safety.content_filter_strength,
      mandated_reporter_protocol: card.safety.mandated_reporter_protocol,
      human_in_loop_categories: card.safety.human_in_loop_required,
    },
    privacy: {
      ferpa_compliant: card.data_privacy.ferpa_compliant,
      coppa_compliant: card.data_privacy.coppa_compliant,
      gdpr_compliant: card.data_privacy.gdpr_compliant,
      retention_days: card.data_privacy.retention_days,
      parents_see: card.data_privacy.data_sharing_with_parents,
      school_sees: card.data_privacy.data_sharing_with_school,
      shares_with_third_parties: card.data_privacy.third_party_data_sharing,
    },
    agent_card_uri: card.agent_card_uri ?? null,
    evaluation_count: card.evaluations?.length ?? 0,
    coppa_check: checkCoppa(card),
  });
}

export async function handleTutorCardSubjectCheck(args: {
  url?: string;
  document_json?: string;
  query: string;
}): Promise<string> {
  const card = await loadCard(args);
  return pretty({
    tutor_id: card.tutor.id,
    query: args.query,
    ...checkSubject(card, args.query),
  });
}

export async function handleTutorCardCoppaCheck(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadCard(args);
  return pretty({
    tutor_id: card.tutor.id,
    ...checkCoppa(card),
  });
}

export const handlers: Record<string, (args: any) => Promise<string>> = {
  tutor_card_well_known_url: handleTutorCardWellKnownUrl,
  tutor_card_fetch: handleTutorCardFetch,
  tutor_card_validate: handleTutorCardValidate,
  tutor_card_inspect: handleTutorCardInspect,
  tutor_card_subject_check: handleTutorCardSubjectCheck,
  tutor_card_coppa_check: handleTutorCardCoppaCheck,
};

export function buildServer(): Server {
  const server = new Server(
    { name: "mcp-ai-tutor", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDescriptors,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const result = await handler(args ?? {});
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });

  return server;
}

// Re-export the schema so consumers can validate inline if they want.
export { tutorCardSchema };

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `mcp-ai-tutor v0.1.0: listening on stdio (${toolDescriptors.length} tools)\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  main().catch((err) => {
    process.stderr.write(`mcp-ai-tutor: fatal: ${err}\n`);
    process.exit(1);
  });
}
