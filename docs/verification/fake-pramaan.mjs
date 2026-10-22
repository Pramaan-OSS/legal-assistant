// Local verification server. Never forwards requests to another service.
import http from 'node:http';
import { readFileSync } from 'node:fs';
const catalogue = JSON.parse(readFileSync(new URL('./app-catalogue-fixture.json', import.meta.url), 'utf8'));
const connections = new Map();
const objects = new Map(), files = new Map(), deliveries = new Map(), uploads = new Map(), replays = new Map();
let storedParts = 0, completedUploads = 0;
let sequence = 0;
const server = http.createServer(async (req,res) => {
 const url = new URL(req.url, 'http://localhost:3417');
 const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(body)); };
 if (url.pathname === '/health') return send({ ok:true, objects:objects.size, deliveries:deliveries.size, storedParts, completedUploads, stagedFiles:files.size });
 if (req.method === 'GET' && url.pathname.startsWith('/private-storage/')) {
  const key=Buffer.from(url.pathname.split('/').pop(),'base64url').toString(); const object=objects.get(key);
  if(!object) return send({error:{code:'not_found'}},404);
  res.writeHead(200,{'Content-Type':object.contentType,'Content-Length':object.bytes.length}); return res.end(object.bytes);
 }
 if (req.headers.authorization !== 'Bearer fake-verification-key') return send({ error:{ code:'unauthorized', message:'Fake verification key required.' } },401);
 const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks);
 if (req.method === 'POST' && url.pathname === '/v1/files') { if(url.searchParams.get('kind')==='part' && (req.headers['content-type']!=='application/octet-stream' || bytes.length>8388608)) return send({error:{code:'invalid_request'}},400); const id = 'file_'+(++sequence); files.set(id,bytes); return send({fileId:id}); }
 if (req.method === 'DELETE' && url.pathname.startsWith('/v1/files/')) {files.delete(url.pathname.split('/').pop());return send({deleted:true});}
 const id = decodeURIComponent(url.pathname.replace('/v1/capabilities/','')); let args;
 try {args=JSON.parse(bytes.toString()||'{}');}catch{return send({error:{code:'invalid_request',message:'Invalid test input.'}},400);}
 console.log('Fake capability:',id);
 if (id === 'llm.chat' && req.headers.accept === 'text/event-stream') {
  const result = {text:'Local fake client reply.',toolCalls:[],finishReason:'stop',usage:{inputTokens:1,outputTokens:2}};
  res.writeHead(200, {'Content-Type':'text/event-stream'});
  res.write('event: text_delta\ndata: '+JSON.stringify({text:result.text})+'\n\n');
  return res.end('event: done\ndata: '+JSON.stringify({result,finishReason:'stop',price_micro:0})+'\n\n');
 }
 if (id === 'llm.chat') return send({text:'Local fake client reply. This is a verification response.',toolCalls:[],finishReason:'stop'});
 if (id === 'llm.complete') return send({text:'Verification conversation'});
 if (id === 'email.send') { const key=req.headers['idempotency-key'];deliveries.set(key,args); return send({id:'fake-mail-'+deliveries.size,status:'sent'}); }
 if (id === 'storage.upload.create') {
  const key='create/'+req.headers['idempotency-key']; if(replays.has(key))return send(replays.get(key));
  const ref='ref_'+(++sequence); uploads.set(ref,{bucket:args.bucket,path:args.path,contentType:args.contentType,parts:new Map()});
  const result={ref,bucket:args.bucket,path:args.path};replays.set(key,result);return send(result);
 }
 if (id === 'storage.upload.parts.list') {const upload=uploads.get(args.ref);if(!upload)return send({error:{code:'not_found'}},404);return send({results:[...upload.parts].map(([partNumber,data])=>({partNumber,sizeBytes:data.length}))});}
 if (id === 'storage.upload.part.put') {
  const upload=uploads.get(args.ref); const file=files.get(args.fileId);if(!upload||!file)return send({error:{code:'not_found'}},404);
  upload.parts.set(args.partNumber,Buffer.from(file));storedParts++;return send({partNumber:args.partNumber,sizeBytes:file.length});
 }
 if (id === 'storage.upload.complete') {
  const key='complete/'+req.headers['idempotency-key'];if(replays.has(key))return send(replays.get(key));
  const upload=uploads.get(args.ref);if(!upload)return send({error:{code:'not_found'}},404);
  const bytes=Buffer.concat([...upload.parts].sort(([a],[b])=>a-b).map(([,data])=>data));
  objects.set(upload.bucket+'/'+upload.path,{bytes,contentType:upload.contentType});completedUploads++;
  const result={bucket:upload.bucket,path:upload.path,sizeBytes:bytes.length};replays.set(key,result);uploads.delete(args.ref);return send(result);
 }
 if (id === 'storage.upload.abort') { uploads.delete(args.ref);return send({aborted:true}); }
 if (id === 'storage.object.download-url') return send({downloadUrl:'http://'+req.headers.host+'/private-storage/'+Buffer.from(args.bucket+'/'+args.path).toString('base64url')+'?signature=fake-private',expiresAt:new Date(Date.now()+3600000).toISOString()});
 if (id === 'storage.object.put') {const key=args.bucket+'/'+args.path;objects.set(key,{bytes:args.content?Buffer.from(args.content,'base64'):files.get(args.fileId),contentType:args.contentType});return send({path:args.path});}
 if (id === 'storage.object.delete') {for(const p of args.paths)objects.delete(args.bucket+'/'+p);return send({deleted:args.paths});}
 if (id === 'storage.objects.list') return send({results:[]});
 if (id === 'storage.object.head' || id === 'storage.object.get') {const entry=objects.get(args.bucket+'/'+args.path);if(!entry)return send({error:{code:'not_found',message:'Test object missing.'}},404);return send(id.endsWith('head')?{sizeBytes:entry.bytes.length,contentType:entry.contentType}:{content:entry.bytes.toString('base64'),contentType:entry.contentType});}
 if (id === 'apps.catalog.search') {
  const words=String(args.query??'').trim().toLowerCase().split(/\s+/), limit=args.limit??10;
  if(!words[0] || limit<1 || limit>50)return send({error:{code:'invalid_request',message:'Use a bounded search.'}},400);
  let offset=0;
  if(args.cursor) {
   let cursor;try{cursor=JSON.parse(Buffer.from(args.cursor,'base64url').toString());}catch{return send({error:{code:'invalid_request'}},400);}
   if(cursor.query!==args.query || cursor.app!==(args.app??null) || cursor.limit!==limit)return send({error:{code:'invalid_request'}},400);
   offset=cursor.offset;
  }
  const found=catalogue.filter(action=>(!args.app||action.app===args.app)&&words.every(word=>(action.app+' '+action.action.replaceAll('_',' ')+' '+action.description).toLowerCase().includes(word)));
  return send({results:found.slice(offset,offset+limit),...(offset+limit<found.length?{nextCursor:Buffer.from(JSON.stringify({query:args.query,app:args.app??null,limit,offset:offset+limit})).toString('base64url')}: {})});
 }
 if (id === 'apps.connection.start') {
  if (!catalogue.some(action => action.app === args.app)) return send({error:{code:'not_found',message:'Fake app missing.'}},404);
  connections.set(args.endUserRef+'/'+args.app,{app:args.app,status:'active',connectedAt:'2026-10-12T00:00:00Z'});
  return send({connectUrl:'http://localhost:3105/settings/connectors',expiresAt:new Date(Date.now()+600000).toISOString()});
 }
 if (id === 'apps.connections.list') return send({results:[...connections.entries()].filter(([key,entry])=>key.startsWith(args.endUserRef+'/') && (!args.app || entry.app === args.app)).map(([,entry])=>entry)});
 if (id === 'apps.connection.revoke') { connections.delete(args.endUserRef+'/'+args.app);return send({revoked:true}); }
 if (id === 'document.parse') {if(!files.has(args.fileId))return send({error:{code:'not_found'}},404);return send({text:'The copied document text.',truncated:false});}
 if (id === 'apps.action.execute') {
  const action=catalogue.find(action=>action.action===args.action);
  if(!action || !connections.has(args.endUserRef+'/'+action.app)) return send({error:{code:'connection_required',message:'Connect the fake owned app first.'}},403);
  if(!args.input || action.inputSchema.required.some(field=>args.input[field]===undefined)) return send({error:{code:'invalid_request',message:'Required fake input is missing.'}},400);
  if(action.action==='GOOGLEDRIVE_DOWNLOAD_FILE') {
   const fileId='file_'+(++sequence);if(args.input.fileId!=='fake-copy-failed')files.set(fileId,Buffer.from('The copied document text.'));
   const copied=args.input.fileId==='fake-copy-failed'?{stored:false,note:'The action ran, but the file could not be copied.'}:{fileId,url:'http://'+req.headers.host+'/files/'+fileId,expiresAt:new Date(Date.now()+3600000).toISOString(),contentType:'text/plain',sizeBytes:25};
   return send({status:'succeeded',output:{downloaded_file_content:copied,message:'Download completed'}});
  }
  return send({status:'succeeded',output:{results:[{id:'fake-item',name:'Verification item'}],display_url:'https://example.test/item'},truncated:false});
 }
 return send({error:{code:'not_found',message:'This fake capability is not configured.'}},404);
});
const port = Number(process.env.FAKE_PRAMAAN_PORT ?? 3417);
server.listen(port,'0.0.0.0',()=>console.log('Fake Pramaan listening on port '+port+'.'));
