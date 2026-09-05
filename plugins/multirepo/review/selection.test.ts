import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedPatch, reviewContext} from './selection';
import type {LinkedDetail} from '../links-contract';
const patch = '@@ -10,3 +10,4 @@\n same\n-old\n+new\n+extra\n end';
test('selection preserves old/new sides and reverse dragging', () => {
  assert.equal(selectedPatch(patch, {start:11,end:11,side:'deletions'}), '-old');
  assert.equal(selectedPatch(patch, {start:12,end:11,side:'additions'}), '+new\n+extra');
  assert.equal(selectedPatch(patch, {start:11,end:12,side:'deletions',endSide:'additions'}), '-old\n+new\n+extra');
});
test('stale selections cannot quote unrelated lines', () => {
  assert.throws(()=>selectedPatch(patch,{start:999,end:1000}), /no longer/);
});
const detail:LinkedDetail = {pr:{url:'https://github.com/org/api/pull/8',repository:'org/api',number:8,title:'Fix',state:'OPEN',isDraft:false},body:'',headRefName:'fix',baseRefName:'main',headRefOid:'a'.repeat(40),baseRefOid:'b'.repeat(40),repositoryRoot:null,files:[{path:'src/check.ts',patch}]};
test('chip identifies the PR revision and selected sides without duplicating instructions', () => {
  assert.equal(reviewContext(detail,'src/check.ts',{start:11,end:12,side:'deletions',endSide:'additions'}), [
    `PR: ${detail.pr.url}`, 'File: "src/check.ts"', `Head: ${detail.headRefOid}`, `Base: ${detail.baseRefOid}`,
    'Lines: old 11–new 12', '```diff', '-old', '+new', '+extra', '```',
  ].join('\n'));
});
test('whole-file and whole-PR chips do not include unselected code or invent missing revisions', () => {
  const legacy = {...detail,headRefOid:undefined,baseRefOid:undefined};
  assert.equal(reviewContext(legacy,null), `PR: ${detail.pr.url}`);
  assert.equal(reviewContext(legacy,'src/check.ts'), `PR: ${detail.pr.url}\nFile: "src/check.ts"`);
});
test('selected code containing backticks cannot terminate its code fence', () => {
  const withFence = {...detail,files:[{path:'notes.md',patch:'@@ -1 +1 @@\n-old\n+```'}]};
  assert.match(reviewContext(withFence,'notes.md',{start:1,end:1,side:'additions'}), /````diff\n\+```\n````$/);
});
