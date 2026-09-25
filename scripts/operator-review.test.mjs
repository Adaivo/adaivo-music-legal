import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyOperatorReview, operatorStatus} from './operator-review.mjs';
// Synthetic fixtures only. No real operator approval is created by these tests.
async function fixture(run) {
 const root=await mkdtemp(join(tmpdir(),'legal-approval-test-'));
 const docs=new Map();
 for(const locale of ['en','zh-Hans','zh-Hant-HK','ko','ja']) for(const kind of ['privacy','terms','licenses']) docs.set(`content/${locale}/${kind}.md`,Buffer.from(`${operatorStatus}\nfixture ${locale} ${kind}`));
 const record={schemaVersion:1,reviewType:'operator-reviewed',release:'2099-01-01.1',effectiveDate:'2099-01-01',reviewer:'TEST FIXTURE ONLY',approvedAt:'2099-01-01T12:00:00.000Z',decision:'approved-for-publication',documents:Object.fromEntries([...docs].map(([p,b])=>[p,createHash('sha256').update(b).digest('hex')]))};
 const save=async()=>{await mkdir(join(root,'approvals'),{recursive:true});await writeFile(join(root,'approvals/operator-review.json'),JSON.stringify(record));};
 const check=()=>verifyOperatorReview(root,'2099-01-01.1','2099-01-01',docs);
 try {await run({docs,record,save,check});}finally{await rm(root,{recursive:true,force:true});}
}
test('rejects missing actual record',()=>fixture(async({check})=>{await assert.rejects(check,/operator_review_required/);}));
test('accepts exact synthetic record and bytes',()=>fixture(async({save,check})=>{await save();await check();}));
test('rejects content edited after approval',()=>fixture(async({save,check,docs})=>{await save();docs.set('content/en/privacy.md',Buffer.from('changed'));await assert.rejects(check,/hash_mismatch/);}));
test('rejects wrong release',()=>fixture(async({save,check,record})=>{record.release='2099-02-01.1';await save();await assert.rejects(check,/metadata/);}));
test('rejects omitted document',()=>fixture(async({save,check,record})=>{delete record.documents['content/en/privacy.md'];await save();await assert.rejects(check,/document_set/);}));
test('rejects fabricated review type',()=>fixture(async({save,check,record})=>{record.reviewType='legal-reviewed';await save();await assert.rejects(check,/metadata/);}));
test('rejects blank reviewer',()=>fixture(async({save,check,record})=>{record.reviewer=' ';await save();await assert.rejects(check,/metadata/);}));
test('rejects draft decision',()=>fixture(async({save,check,record})=>{record.decision='draft';await save();await assert.rejects(check,/metadata/);}));

test('real validator and generators enforce record before release; generated notices preserve reviewed bytes', async()=>{
 const {cp,readFile}=await import('node:fs/promises');
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const repo=fileURLToPath(new URL('..',import.meta.url));
 const root=await mkdtemp(join(tmpdir(),'legal-operator-integration-'));
 try {
  await cp(join(repo,'content'),join(root,'content'),{recursive:true});
  await cp(join(repo,'inventory'),join(root,'inventory'),{recursive:true});
  const hashes={};
  for(const locale of ['en','zh-Hans','zh-Hant-HK','ko','ja']) for(const kind of ['privacy','terms','licenses']){
   const path=`content/${locale}/${kind}.md`;let text=await readFile(join(root,path),'utf8');
   const title=text.split('\n')[0], body=text.slice(text.indexOf('\n## '));
   const metadata=locale==='zh-Hans'?'**发布版本：** 2026-08-08.1\n**生效日期：** 2026-08-08':'**Release:** 2026-08-08.1\n**Effective date:** 2026-08-08';
   text=`${title}\n\n**Document status:** ${operatorStatus}\n${metadata}${body}`;
   // Synthetic link fixture must not depend on the repository's current legal copy.
   if(locale==='en' && kind==='privacy') text+='\n[Google privacy fixture](https://policies.google.com/privacy)\n';
   await writeFile(join(root,path),text);hashes[path]=createHash('sha256').update(text).digest('hex');
  }
  const args=['scripts/verify-draft-content.mjs','--root',root,'--mode','release-ready','--release','2026-08-08.1','--effective-date','2026-08-08'];
  let result=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/operator_review_required/);
  const build=['scripts/build-runtime-notices.mjs','--content-root',root,'--output-dir',join(root,'output'),'--release','2026-08-08.1','--effective-date','2026-08-08'];
  result=spawnSync(process.execPath,build,{cwd:repo,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/operator_review_required/);
  await mkdir(join(root,'approvals'));
  await writeFile(join(root,'approvals/operator-review.json'),JSON.stringify({schemaVersion:1,reviewType:'operator-reviewed',reviewer:'SYNTHETIC TEST ONLY',approvedAt:'2026-09-25T00:00:00.000Z',decision:'approved-for-publication',release:'2026-08-08.1',effectiveDate:'2026-08-08',documents:hashes}));
  result=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  result=spawnSync(process.execPath,build,{cwd:repo,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  for(const locale of ['en','zh-Hans','zh-Hant-HK','ko','ja'])assert.deepEqual(await readFile(join(root,'output/content',locale,'licenses.md')),await readFile(join(root,'content',locale,'licenses.md')));
  const manifestBuild=['scripts/build-manifest.mjs','--content-root',root,'--output-dir',join(root,'manifest-output'),'--release','2026-08-08.1','--effective-date','2026-08-08'];
  result=spawnSync(process.execPath,manifestBuild,{cwd:repo,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const privacyPath=join(root,'content/en/privacy.md');const approvedPrivacy=await readFile(privacyPath,'utf8');
  assert.match(approvedPrivacy,/https:\/\/policies\.google\.com\/privacy/);
  const foreignHost=approvedPrivacy.replaceAll('https://policies.google.com/privacy','https://policies.google.com.evil.example/privacy');
  await writeFile(privacyPath,foreignHost);
  const approvalPath=join(root,'approvals/operator-review.json');const approval=JSON.parse(await readFile(approvalPath,'utf8'));
  approval.documents['content/en/privacy.md']=createHash('sha256').update(foreignHost).digest('hex');await writeFile(approvalPath,JSON.stringify(approval));
  result=spawnSync(process.execPath,manifestBuild,{cwd:repo,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/URL not allowed/);
  await writeFile(privacyPath,approvedPrivacy);approval.documents['content/en/privacy.md']=hashes['content/en/privacy.md'];await writeFile(approvalPath,JSON.stringify(approval));
  const path=join(root,'content/en/privacy.md');await writeFile(path,(await readFile(path,'utf8'))+'\nchanged after test approval\n');
  result=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/hash_mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
