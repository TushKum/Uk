import {spawn} from 'node:child_process';
const port=process.env.PORT??'3001';if(!/^\d+$/.test(port))throw new Error('PORT must be a number');
const children=[spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',port],{stdio:'inherit',env:process.env}),spawn(process.execPath,['--import','tsx','scripts/worker.ts'],{stdio:'inherit',env:process.env})];
let stopping=false;
function stop(code:number){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');const timer=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');},10000);timer.unref();Promise.all(children.map(c=>new Promise<void>(resolve=>{if(c.pid===undefined||c.exitCode!==null||c.signalCode!==null)resolve();else c.once('exit',()=>resolve());}))).then(()=>{clearTimeout(timer);process.exit(code);});}
for(const child of children){child.once('error',()=>stop(1));child.once('exit',code=>{if(!stopping)stop(code??1);});}
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
