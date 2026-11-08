'use client';
export default function GlobalError({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <html lang="en"><body style={{background:'#10120f',color:'#f0f0dc',fontFamily:'monospace',padding:32}}><h1>LeakLoop is unavailable.</h1><p>An unexpected error stopped the page from loading. Saved records are unaffected.{error.digest?` Reference: ${error.digest}`:''}</p><button onClick={()=>reset()}>Try again</button></body></html>;
}
