import {useSyncExternalStore} from 'react';
function notify(){window.dispatchEvent(new Event('popstate'));}
const subscribe=(callback:()=>void)=>{window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback);};
export function usePathname(){return useSyncExternalStore(subscribe,()=>window.location.pathname);}
export function useSearchParams(){const value=useSyncExternalStore(subscribe,()=>window.location.search);return new URLSearchParams(value);}
export function useRouter(){return {push:(url:string)=>{history.pushState(null,'',url);notify();},replace:(url:string)=>{history.replaceState(null,'',url);notify();},refresh:notify,back:()=>history.back()};}
export function Link({href,children,prefetch,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{href:string;prefetch?:boolean}){void prefetch;return <a href={href} {...props} onClick={e=>{props.onClick?.(e);if(!e.defaultPrevented&&!e.ctrlKey&&!e.metaKey&&href.startsWith('/')){e.preventDefault();history.pushState(null,'',href);notify();}}}>{children}</a>;}
export function Image({priority,fill,unoptimized,alt='',...props}:React.ImgHTMLAttributes<HTMLImageElement>&{priority?:boolean;fill?:boolean;unoptimized?:boolean}){void priority;void fill;void unoptimized;
 // Native image is intentional: this isolated Vite harness has no Next image optimizer.
 // eslint-disable-next-line @next/next/no-img-element
 return <img {...props} alt={alt}/>;}
