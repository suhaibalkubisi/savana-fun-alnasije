import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
// In-process transpilation also runs in restricted Windows environments where
// a native bundler cannot traverse the workspace. Production build is separate.
export async function compileFollowupReports(outdir){
  await fs.mkdir(outdir,{recursive:true});
  for(const [source,target] of [['components/followup/exports.ts','exports.mjs'],['components/followup/report-model.ts','report-model.mjs'],['components/followup/domain.ts','domain.mjs'],['lib/hr/brand.ts','brand.mjs']]){
    const code=await fs.readFile(path.resolve(source),'utf8');
    const result=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll("'./domain'","'./domain.mjs'").replaceAll("'@/lib/hr/brand'","'./brand.mjs'");
    await fs.writeFile(path.join(outdir,target),result);
  }
}
