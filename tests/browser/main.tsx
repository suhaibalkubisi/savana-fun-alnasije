import React from 'react';
import {createRoot} from 'react-dom/client';
import {HRApp} from '../../components/hr/app';
import '../../app/globals.css';
import '../../app/workspace-theme.css';
import '../../app/workspace-shell.css';
import '../../app/product-workspaces.css';
// Test harness only: retain the exact browser-generated download bytes locally.
// Native download handling is left intact. No production bundle imports this file.
document.addEventListener('click',event=>{
 const anchor=(event.target as Element)?.closest?.('a[download]') as HTMLAnchorElement|null;
 if(anchor?.href.startsWith('blob:'))void fetch(anchor.href).then(r=>r.blob()).then(blob=>fetch('/api/qa-export?name='+encodeURIComponent(anchor.download),{method:'POST',body:blob})).then(async response=>{if(!response.ok)throw Error(await response.text());console.info('QA export saved',anchor.download);}).catch(console.error);
});
createRoot(document.getElementById('root')!).render(<React.StrictMode><HRApp/></React.StrictMode>);
