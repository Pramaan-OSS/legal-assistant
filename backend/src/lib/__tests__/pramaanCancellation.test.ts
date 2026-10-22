import { afterEach, expect, it, vi } from 'vitest';
import { callCapabilityAbortable, setPramaanClientForTests, type PramaanClient } from '../pramaan';
afterEach(()=>setPramaanClientForTests());
it('stops waiting and cancels an owned running job once', async()=>{
 const get=vi.fn(()=>new Promise(()=>{})); const cancel=vi.fn().mockResolvedValue({id:'job-one',status:'cancelled'});
 setPramaanClientForTests({call:vi.fn(),run:vi.fn().mockResolvedValue({id:'job-one',status:'running'}),jobs:{get,cancel}} as PramaanClient);
 const controller=new AbortController(); const pending=callCapabilityAbortable('llm.chat',{messages:[]},controller.signal);
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(get).toHaveBeenCalledOnce()); controller.abort(); await rejected;
 expect(cancel).toHaveBeenCalledExactlyOnceWith('job-one');
});
it('cancels a late job response after the user has already stopped', async()=>{
 let start: (value: unknown)=>void = ()=>{};
 const run=vi.fn(()=>new Promise(resolve=>{start=resolve})); const get=vi.fn(); const cancel=vi.fn().mockResolvedValue({id:'late-job',status:'cancelled'});
 setPramaanClientForTests({call:vi.fn(),run,jobs:{get,cancel}} as PramaanClient);
 const controller=new AbortController(); const pending=callCapabilityAbortable('llm.chat',{messages:[]},controller.signal);
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(run).toHaveBeenCalledOnce()); controller.abort(); await rejected;
 start({id:'late-job',status:'running'}); await vi.waitFor(()=>expect(cancel).toHaveBeenCalledExactlyOnceWith('late-job'));
 expect(get).not.toHaveBeenCalled();
});
