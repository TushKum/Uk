'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Move,Pause,Play,RotateCcw} from 'lucide-react';
import type {Building,Reading} from '@/lib/types';

type Props={buildings:Building[];readings:Reading[];now:number;selected:string;onSelect:(id:string)=>void};
export default function CampusScene(props:Props){
 const host=useRef<HTMLDivElement>(null),snapshot=useRef(props),api=useRef<{reset:()=>void;refresh:()=>void}|null>(null);
 const [status,setStatus]=useState<'loading'|'ready'|'fallback'>('loading'),[playing,setPlaying]=useState(false);
 const playRef=useRef(false);snapshot.current=props;playRef.current=playing;
 useEffect(()=>{api.current?.refresh();},[props.selected,props.readings,playing]);
 useEffect(()=>{
  let disposed=false,cleanup=()=>{};
  async function initialize(){
   const THREE=await import('three');const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');
   if(disposed||!host.current)return;
   const container=host.current;let renderer:InstanceType<typeof THREE.WebGLRenderer>;
   try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{setStatus('fallback');return;}
   renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.7));renderer.setClearColor(0x1b201c);container.appendChild(renderer.domElement);
   renderer.domElement.setAttribute('aria-label','Interactive simulated three-dimensional campus. Drag to orbit; select buildings using the buttons below.');renderer.domElement.setAttribute('role','img');
   const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,120);camera.position.set(18,17,22);
   const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.6,0);controls.enablePan=false;controls.enableDamping=false;controls.minDistance=17;controls.maxDistance=38;controls.minPolarAngle=.35;controls.maxPolarAngle=1.25;controls.update();controls.saveState();
   scene.add(new THREE.AmbientLight(0xffffff,2.1));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(8,18,5);scene.add(sun);
   const resources:{dispose:()=>void}[]=[];const selectable:InstanceType<typeof THREE.Mesh>[]=[];const highlights:{id:string;material:InstanceType<typeof THREE.LineBasicMaterial>;fill:InstanceType<typeof THREE.MeshStandardMaterial>}[]=[];
   function block(w:number,h:number,d:number,x:number,y:number,z:number,color:number,buildingId?:string){
    const geo=new THREE.BoxGeometry(w,h,d),mat=new THREE.MeshStandardMaterial({color,roughness:1,metalness:0});const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);scene.add(mesh);resources.push(geo,mat);
    const edgesGeo=new THREE.EdgesGeometry(geo),edgeMat=new THREE.LineBasicMaterial({color:0x727a69});const edges=new THREE.LineSegments(edgesGeo,edgeMat);mesh.add(edges);resources.push(edgesGeo,edgeMat);
    if(buildingId){mesh.userData.buildingId=buildingId;selectable.push(mesh);highlights.push({id:buildingId,material:edgeMat,fill:mat});}return mesh;
   }
   block(19,.3,13,0,-.23,0,0x30362c);
   const grid=new THREE.GridHelper(24,24,0x58634d,0x333d31);grid.position.y=-.05;scene.add(grid);resources.push(grid.geometry,...(Array.isArray(grid.material)?grid.material:[grid.material]));
   // Illustrative geometry only. Dimensions do not encode actual floor area or measured flow.
   block(3.4,4.4,2.3,-5,2.2,-1.7,0xc6c6b5,'north');block(2.1,3.3,2.3,-2.2,1.65,-1.7,0xa6ad98,'north');block(6.2,.35,2.7,-3.7,4.58,-1.7,0xd2d1bd,'north');
   block(4.7,2.5,2.7,3.8,1.25,-2.4,0xc2c3b1,'science');block(5.2,.3,3.1,3.8,2.65,-2.4,0xe2dfc9,'science');block(1.2,1.2,1.5,5.1,3.3,-2.4,0x858e7c,'science');
   block(3.6,1.8,3.2,1.4,.9,3.6,0xd1cebb,'commons');block(2.6,2.6,1.5,-1.1,1.3,4.4,0xb7bea7,'commons');block(3.9,.25,3.5,1.4,1.98,3.6,0xe0dfca,'commons');
   for(const [baseX,z,y,count] of [[-5,-.535,1,3],[3.8,-1.035,.8,2],[1.4,5.215,.65,1]])for(let row=0;row<count;row++)for(let col=0;col<4;col++)block(.42,.22,.025,baseX-1.15+col*.75,y+row*.95,z,0x3a4535);
   const pipePoints=[new THREE.Vector3(-7,.13,4.6),new THREE.Vector3(-5,.13,4.6),new THREE.Vector3(-5,.13,.5),new THREE.Vector3(4.7,.13,.5),new THREE.Vector3(4.7,.13,-.8)];
   const curve=new THREE.CurvePath<InstanceType<typeof THREE.Vector3>>();for(let n=1;n<pipePoints.length;n++)curve.add(new THREE.LineCurve3(pipePoints[n-1],pipePoints[n]));
   const pipeGeo=new THREE.TubeGeometry(curve,50,.07,5,false),pipeMat=new THREE.MeshBasicMaterial({color:0x80e2dc});scene.add(new THREE.Mesh(pipeGeo,pipeMat));resources.push(pipeGeo,pipeMat);
   const branch=new THREE.CylinderGeometry(.06,.06,3.4,5),branchMat=new THREE.MeshBasicMaterial({color:0x80e2dc});const branchMesh=new THREE.Mesh(branch,branchMat);branchMesh.rotation.x=Math.PI/2;branchMesh.position.set(1.4,.13,2.2);scene.add(branchMesh);resources.push(branch,branchMat);
   const dots:InstanceType<typeof THREE.Mesh>[]=[];const dotGeo=new THREE.SphereGeometry(.12,6,4),dotMat=new THREE.MeshBasicMaterial({color:0xe6ffd4});resources.push(dotGeo,dotMat);for(let n=0;n<6;n++){const dot=new THREE.Mesh(dotGeo,dotMat);scene.add(dot);dots.push(dot);}
   const markerGeo=new THREE.OctahedronGeometry(.23),markerMat=new THREE.MeshBasicMaterial({color:0xff9c59});const marker=new THREE.Mesh(markerGeo,markerMat);marker.position.set(-5,5.8,-1.7);scene.add(marker);resources.push(markerGeo,markerMat);
   // Labels are rendered on the model as crisp canvas textures, with HTML equivalents below.
   for(const [label,x,y,z] of [['01',-5,5,-1.7],['02',3.8,3.8,-2.4],['03',1.4,2.7,3.6]] as const){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=80;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#c8ff62';ctx.fillRect(0,0,128,80);ctx.fillStyle='#15210e';ctx.font='bold 54px monospace';ctx.textAlign='center';ctx.fillText(label,64,59);const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteMaterial({map:texture,depthTest:false});const sprite=new THREE.Sprite(material);sprite.position.set(x,y,z);sprite.scale.set(1.05,.66,1);scene.add(sprite);resources.push(texture,material);}
   const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let frame=0,phase=0,visible=true,last=0;
   function render(){if(disposed)return;const selected=snapshot.current.selected;highlights.forEach(h=>{h.material.color.setHex(h.id===selected?0xc8ff62:0x69725e);h.fill.color.setHex(h.id===selected?0xd5debd:0x9da68f);});dots.forEach((dot,n)=>dot.position.copy(curve.getPoint((phase+n/6)%1)));renderer.render(scene,camera);}
   function animate(ts:number){if(disposed)return;frame=requestAnimationFrame(animate);if(playRef.current&&!reduced.matches&&visible&&!document.hidden&&ts-last>32){phase=(phase+.0013)%1;render();last=ts;}}
   const observer=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();render();});observer.observe(container);
   const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;});intersection.observe(container);
   controls.addEventListener('change',render);const raycaster=new THREE.Raycaster();let down={x:0,y:0};
   const pointerDown=(event:PointerEvent)=>{down={x:event.clientX,y:event.clientY};};
   const pointerUp=(event:PointerEvent)=>{if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);const hit=raycaster.intersectObjects(selectable,false)[0];if(hit){snapshot.current.onSelect(hit.object.userData.buildingId);render();}};
   const contextLost=(event:Event)=>{event.preventDefault();setStatus('fallback');};renderer.domElement.addEventListener('webglcontextlost',contextLost);renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
   api.current={reset:()=>{controls.reset();render();},refresh:render};frame=requestAnimationFrame(animate);render();setStatus('ready');
   cleanup=()=>{api.current=null;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();controls.removeEventListener('change',render);controls.dispose();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('webglcontextlost',contextLost);resources.forEach(r=>r.dispose());renderer.dispose();renderer.domElement.remove();};
  }
  initialize().catch(()=>{if(!disposed)setStatus('fallback');});return()=>{disposed=true;cleanup();};
 },[]);
 const selected=props.buildings.find(b=>b.id===props.selected)!;const latest=props.readings.filter(r=>r.buildingId===props.selected).at(-1);const valid=latest?.quality==='valid'&&latest.value!==null&&props.now-latest.at<=1200000;
 return <section className="campus-stage" aria-label="Campus spatial overview">
  <div className="stage-statement"><span className="eyebrow">WATER OPERATIONS / EVERGREEN</span><h2>EVERY<br/>DROP.<br/><em>ON RECORD.</em></h2><p>Investigate the anomaly.<br/>Verify the outcome.</p><div className="stage-reading"><span>{selected.meter} / SELECTED METER</span><strong>{valid?latest.value:'—'}<small>L/MIN</small></strong><span>{selected.name}</span></div></div>
  <div className="stage-model"><div className="stage-model-heading"><span><i/>SIMULATED CAMPUS / 3D SCHEMATIC</span><span>THREE.JS · WEBGL</span></div><div ref={host} className="three-host"/>{status!=='ready'&&<div className="scene-fallback">{status==='loading'?'LOADING SPATIAL VIEW…':'3D UNAVAILABLE — USE THE BUILDING SELECTOR BELOW'}<span>The operational dashboard remains available.</span></div>}<div className="stage-controls"><span><Move size={12}/>DRAG TO ORBIT · CLICK TO SELECT</span><div><button onClick={()=>{setPlaying(v=>!v);}} aria-label={playing?'Pause flow animation':'Play flow animation'} disabled={status!=='ready'}>{playing?<Pause size={13}/>:<Play size={13}/>}</button><button onClick={()=>api.current?.reset()} aria-label="Reset campus view" disabled={status!=='ready'}><RotateCcw size={13}/></button></div></div></div>
  <div className="stage-building-selector">{props.buildings.map((b,n)=><button key={b.id} aria-pressed={props.selected===b.id} onClick={()=>props.onSelect(b.id)}><span>0{n+1}</span><strong>{b.name}</strong><ArrowUpRight size={16}/></button>)}</div>
 </section>;
}
