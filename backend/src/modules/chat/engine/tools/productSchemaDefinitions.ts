import * as coreDefinitions from './toolSchemas';
import type { ToolSchema } from '../../../../lib/llm';
import { CASE_LAW_TOOLS } from './caseLawTools';
import { WORD_CLIENT_TOOLS } from './wordClientTools';
import { PUBLIC_RESEARCH_TOOLS } from './publicResearchTools';
import { DOCUMENT_OUTCOME_TOOLS, PUBLIC_OUTCOME_TOOLS } from './outcomeTools';
const core = (Object.values(coreDefinitions) as unknown[]).filter((value): value is ToolSchema[] =>
  Array.isArray(value) && value.every(entry => entry && typeof entry === 'object' && typeof entry.function?.name === 'string'));
export const ALL_CHAT_SCHEMA_DEFINITIONS = [
  ...core.flat(), ...CASE_LAW_TOOLS,
  ...WORD_CLIENT_TOOLS, ...PUBLIC_RESEARCH_TOOLS, ...DOCUMENT_OUTCOME_TOOLS, ...PUBLIC_OUTCOME_TOOLS,
];
