import test from 'node:test';
import assert from 'node:assert/strict';
import {importDiagnostics} from '../lib/hr/import-diagnostics.mjs';
test('review groups distinguish missing history from incomplete evidence and coverage',()=>{
 const groups=importDiagnostics({rows:[{key:'one',name:'Test',employee_id:'one',internal_code:'FANU-001',cells:{1:{state:'missing_assignment',date:'2026-09-01'},2:{state:'missing_assignment',date:'2026-09-02'},3:{state:'single',date:'2026-09-03'},4:{state:'outside_coverage',date:'2026-09-04'}}}]});
 assert.equal(groups[0].cause,'missing_assignment');assert.equal(groups[0].days,2);assert.equal(groups[0].people.length,1);
 assert.equal(groups.find(g=>g.cause==='single').blocksCalculation,false);
 assert.equal(groups.find(g=>g.cause==='outside_coverage').blocksCalculation,false);
});
test('a complete pair with an open decision is never explained as clear',()=>{
 assert.equal(importDiagnostics({rows:[{key:'x',cells:{1:{state:'complete',pending:true,date:'2026-09-01'}}}]}).at(0).cause,'pending');
});
