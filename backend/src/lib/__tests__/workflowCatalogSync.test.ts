import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { syncWorkflowCatalog } from '../workflowCatalogSync';
const storage = vi.hoisted(() => ({ upload:vi.fn() }));
vi.mock('../storage',()=>({storageEnabled:true, uploadFile:storage.upload}));
let directory: string | undefined;
afterEach(async()=>{storage.upload.mockReset();if(directory)await rm(directory,{recursive:true,force:true});directory=undefined;});
it('transactionally replaces the local catalogue and cleans temporary files',async()=>{
 directory=await mkdtemp(path.resolve('.catalog-sync-test-'));
 const rpc=vi.fn().mockResolvedValue({error:null});
 const result=await syncWorkflowCatalog({rpc} as never,{temporaryRoot:directory,fetchImpl:vi.fn(()=>{throw new Error('No network.');})});
 expect(result.workflows).toBe(4);expect(result.assets).toBe(0);
 expect(rpc).toHaveBeenCalledWith('replace_legal_assistant_workflows',expect.objectContaining({p_workflows:expect.arrayContaining([expect.objectContaining({workflow_key:'proofread'})])}));
 expect(await readdir(directory)).toEqual([]);expect(storage.upload).not.toHaveBeenCalled();
});
it('cleans temporary files after database replacement fails',async()=>{
 directory=await mkdtemp(path.resolve('.catalog-sync-test-'));const rpc=vi.fn().mockResolvedValue({error:{message:'database unavailable'}});
 await expect(syncWorkflowCatalog({rpc} as never,{temporaryRoot:directory})).rejects.toThrow();expect(await readdir(directory)).toEqual([]);
});
