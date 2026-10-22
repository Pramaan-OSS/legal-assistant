import { describe, expect, it } from 'vitest';
import { MODELS, isModelAvailable } from '../shared/lib/modelCatalog';
import { isModelAvailable as addinAvailable } from '../../../word-addin/src/taskpane/lib/modelCatalog';
import { reasoningLevelsForModel } from '../../../backend/src/lib/llm/models';
describe('shared quality catalog', () => {
 it('offers only the three registered quality choices', () => { expect(MODELS.map(m => m.id)).toEqual(['fast', 'balanced', 'best']); });
 it('keeps Word and web access checks aligned', () => { for(const {id} of MODELS) { expect(addinAvailable(id, {capability:true})).toBe(isModelAvailable(id, {capability:{configured:true}})); expect(addinAvailable(id, {capability:false})).toBe(false); expect(reasoningLevelsForModel(id)).toEqual([]); } });
});
