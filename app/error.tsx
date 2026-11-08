'use client';
import {useEffect} from 'react';
export default function ErrorPage({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 useEffect(()=>{console.error('ui_error',error.digest??'');},[error]);
 return <div className="initial"><span className="sim-badge">LEAKLOOP</span><h1>Something went wrong.</h1><p>The workspace hit an unexpected error. Your saved records are unaffected; nothing was approved or changed by this error.{error.digest?` Reference: ${error.digest}`:''}</p><div className="row"><button className="primary" onClick={()=>reset()}>Try again</button><a className="secondary" href="/">Reload workspace</a></div></div>;
}
