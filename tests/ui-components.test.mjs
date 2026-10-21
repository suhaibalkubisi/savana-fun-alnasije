import assert from "node:assert/strict";
import { readdir, readFile, writeFile, rm, mkdir, access } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const compiled=path.join(root,'outputs','acceptance','ui-test');await mkdir(compiled,{recursive:true});
const seen=new Set();
// Load the actual components and their local dependencies in process. This
// avoids a native bundler traversing restricted Windows ancestor directories.
async function compile(source){
  const file=path.join(compiled,path.relative(root,source).replace(/\.[^.]+$/,'.mjs'));
  if(seen.has(source))return file;
  seen.add(source);
  const raw=await readFile(source,'utf8');
  let code=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const tree=ts.createSourceFile(source,code,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
  const imports=tree.statements.filter(s=>(ts.isImportDeclaration(s)||ts.isExportDeclaration(s))&&s.moduleSpecifier&&ts.isStringLiteral(s.moduleSpecifier)).map(s=>s.moduleSpecifier.text);
  for(const specifier of imports){
    if(!specifier.startsWith('@/')&&!specifier.startsWith('.'))continue;
    const base=specifier.startsWith('@/')?path.join(root,specifier.slice(2)):path.resolve(path.dirname(source),specifier);
    const local=await Promise.any([base,...['.tsx','.ts','.mjs','.js','/index.tsx','/index.ts'].map(suffix=>base+suffix)].map(async candidate=>{await access(candidate);return candidate;}));
    const relative=path.relative(root,local);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('UI test dependency outside workspace');
    const target=await compile(local);
    let outputSpecifier=path.relative(path.dirname(file),target).replaceAll('\\','/');
    if(!outputSpecifier.startsWith('.'))outputSpecifier='./'+outputSpecifier;
    code=code.replaceAll(JSON.stringify(specifier),JSON.stringify(outputSpecifier));
  }
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,code);
  return file;
}
const vite={ssrLoadModule:async(source)=>import(pathToFileURL(await compile(path.join(root,source.slice(1)))).href)};
after(async()=>{await rm(compiled,{recursive:true,force:true});});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("retains animation, accessible scrolling and reduced-motion styles used by the app", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(
    React.createElement(Progress, { value: 37 }),
  );

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});
