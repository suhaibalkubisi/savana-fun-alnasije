import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Extract the production helpers without loading unrelated export dependencies.
const source = await readFile(new URL('../components/followup/exports.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('exports.ts', source, ts.ScriptTarget.Latest, true);
const declarations = parsed.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ['priorDownload','priorPreview'].includes(d.name.getText(parsed)))) ||
  (ts.isFunctionDeclaration(node) && ['clearDownloads', 'download'].includes(node.name?.text)),
);
assert.equal(declarations.length, 4, 'The harness must use the production download/preview state and both production helpers');
const compiled = ts.transpileModule(declarations.map(node => node.getText(parsed)).join('\n') + '\nglobalThis.cleanupHarness={download,clearDownloads,retainPreview(value){priorPreview=value;}};', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const children = [], anchors = [], revoked = [], events = [];
  const body = { appendChild(anchor) { children.push(anchor); events.push('append:' + anchor.href); } };
  const context = {
    exports: {}, Blob,
    document: {
      body,
      getElementsByTagName(tag) { assert.equal(tag, 'body'); return [body]; },
      createElement(tag) {
        assert.equal(tag, 'a');
        const anchor = {
          clicks: 0, removals: 0,
          click() { this.clicks++; },
          remove() { this.removals++; children.splice(children.indexOf(this), 1); events.push('remove:' + this.href); },
        };
        anchors.push(anchor); return anchor;
      },
    },
    URL: {
      createObjectURL(blob) { assert.ok(blob instanceof Blob); const url = 'blob:synthetic/' + (anchors.length + 1); events.push('create:' + url); return url; },
      revokeObjectURL(url) { revoked.push(url); events.push('revoke:' + url); },
    },
  };
  vm.runInNewContext(compiled, context);
  return { ...context.cleanupHarness, children, anchors, revoked, events };
}

test('clearDownloads on a clean state creates no link or URL', () => {
  const h = harness();
  h.clearDownloads(); h.clearDownloads();
  assert.deepEqual(h.children, []); assert.deepEqual(h.anchors, []); assert.deepEqual(h.revoked, []);
});

test('replacing a download revokes its URL and removes its link before adding the next', () => {
  const h = harness();
  h.download(new Uint8Array([1]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'first.xlsx');
  const first = h.children[0];
  h.download(new Uint8Array([2]), 'application/pdf', 'next.pdf');
  assert.equal(first.removals, 1); assert.equal(first.clicks, 1);
  assert.deepEqual(h.revoked, ['blob:synthetic/1']);
  assert.equal(h.children.length, 1); assert.equal(h.children[0].download, 'next.pdf');
  assert.equal(h.children[0].textContent, 'تنزيل next.pdf'); assert.equal(h.children[0].clicks, 1);
  assert.deepEqual(h.events.slice(2, 5), ['revoke:blob:synthetic/1', 'remove:blob:synthetic/1', 'create:blob:synthetic/2']);
});

test('clearDownloads removes and revokes the current report once, then resets retained state', () => {
  const h = harness();
  h.download(new Uint8Array([1]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'account-a.xlsx');
  const first = h.children[0];
  h.clearDownloads(); h.clearDownloads();
  assert.equal(first.removals, 1); assert.deepEqual(h.children, []);
  assert.deepEqual(h.revoked, ['blob:synthetic/1']);
  h.download(new Uint8Array([2]), 'application/pdf', 'account-b.pdf');
  assert.equal(first.removals, 1); assert.deepEqual(h.revoked, ['blob:synthetic/1']);
  assert.equal(h.children.length, 1); assert.equal(h.children[0].download, 'account-b.pdf');
  h.clearDownloads(); h.clearDownloads();
  assert.deepEqual(h.children, []); assert.equal(h.anchors[1].removals, 1);
  assert.deepEqual(h.revoked, ['blob:synthetic/1', 'blob:synthetic/2']);
});

test('clearing a session revokes retained print previews once alongside downloads',()=>{
  const h=harness();
  h.download(new Uint8Array([1]),'application/pdf','report.pdf');
  h.retainPreview('blob:synthetic/preview');
  h.clearDownloads();h.clearDownloads();
  assert.deepEqual(h.revoked,['blob:synthetic/1','blob:synthetic/preview']);
  assert.deepEqual(h.children,[]);
});
