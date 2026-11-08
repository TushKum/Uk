// Small browser helper for JSON API calls. Throws the server's generic message on failure.
export async function api<T=Record<string,unknown>>(path:string,init:{method?:string;body?:unknown}={}):Promise<T>{
 const res=await fetch(path,{method:init.method??'GET',cache:'no-store',headers:init.body!==undefined?{'Content-Type':'application/json'}:undefined,body:init.body!==undefined?JSON.stringify(init.body):undefined});
 let data:Record<string,unknown>={};try{data=await res.json();}catch{}
 if(!res.ok){const fields=Array.isArray(data.fields)?` (${(data.fields as {path:string;message:string}[]).map(f=>`${f.path}: ${f.message}`).join('; ')})`:'';throw new Error(`${String(data.error??`Request failed (${res.status})`)}${fields}${data.requestId?` · ref ${String(data.requestId).slice(0,8)}`:''}`);}
 return data as T;
}
export const when=(v:string|number|null|undefined)=>v?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'—';
export const bytes=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
