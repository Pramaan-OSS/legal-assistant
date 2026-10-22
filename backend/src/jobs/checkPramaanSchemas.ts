import { normalizePramaanSchema } from '../lib/pramaan';
import { ALL_CHAT_SCHEMA_DEFINITIONS } from '../modules/chat/chat.service';
import { MEMORY_CURATOR_WRITE_TOOL } from '../modules/memory/memory.service';

/** Connected schemas are checked at discovery and dispatch. */
export const PRODUCT_SCHEMA_DEFINITIONS = [...ALL_CHAT_SCHEMA_DEFINITIONS, MEMORY_CURATOR_WRITE_TOOL];
export function checkProductSchemas(): number {
  for (const definition of PRODUCT_SCHEMA_DEFINITIONS) normalizePramaanSchema(definition.function.parameters, definition.function.name);
  return PRODUCT_SCHEMA_DEFINITIONS.length;
}
if (require.main === module) console.log(`${checkProductSchemas()} product schemas checked.`);
