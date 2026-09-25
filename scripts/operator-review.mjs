import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const operatorStatus = 'OPERATOR REVIEWED — APPROVED FOR PUBLICATION BY OPERATOR — NO LEGAL OR NATIVE-LANGUAGE REVIEW CLAIM';
const paths=['en','zh-Hans','zh-Hant-HK','ko','ja'].flatMap(locale=>['privacy','terms','licenses'].map(kind=>`content/${locale}/${kind}.md`)).sort();
export async function verifyOperatorReview(root,release,effectiveDate,documents) {
 let record;
 try {record=JSON.parse(await readFile(resolve(root,'approvals/operator-review.json'),'utf8'));}
 catch {throw new Error('release_ready_rejected: operator_review_required');}
 assert(record && record.schemaVersion===1 && record.reviewType==='operator-reviewed' && record.release===release && record.effectiveDate===effectiveDate && record.decision==='approved-for-publication' && typeof record.reviewer==='string' && record.reviewer.trim().length>0 && typeof record.approvedAt==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.approvedAt) && Number.isFinite(Date.parse(record.approvedAt)), 'release_ready_rejected: operator_review_metadata');
 assert(record.documents && typeof record.documents==='object' && !Array.isArray(record.documents), 'release_ready_rejected: operator_review_document_set');
 assert.deepEqual(Object.keys(record.documents).sort(),paths,'release_ready_rejected: operator_review_document_set');
 assert.deepEqual([...documents.keys()].sort(),paths,'release_ready_rejected: operator_review_document_set');
 for(const path of paths) {
  const bytes=documents.get(path);
  assert(Buffer.isBuffer(bytes),'release_ready_rejected: operator_review_bytes_required');
  assert.equal(record.documents[path],createHash('sha256').update(bytes).digest('hex'),`release_ready_rejected: operator_review_hash_mismatch: ${path}`);
 }
}
