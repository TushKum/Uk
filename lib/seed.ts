import type { State, Scenario } from './types';
export const START = Date.parse('2026-11-08T06:00:00+05:30');
export function seed(scenario:Scenario='A'):State {
 const buildings = [
 {id:'north',name:'North Residence',type:'Student housing',meter:'WM-001',low:18,high:38,location:'North wing · Ground floor · Meter room'},
 {id:'science',name:'Science Centre',type:'Teaching & research',meter:'WM-002',low:12,high:30,location:'Science Centre · Service entrance'},
 {id:'commons',name:'Campus Commons',type:'Dining & shared spaces',meter:'WM-003',low:22,high:45,location:'Commons · Utility room'}
 ];
 const readings:State['readings']=[];
 for(let i=0;i<=96;i++) for(const [j,b] of buildings.entries()) {
  const at=START-(96-i)*900000; const overnight=at>=START-6*3600000;
  let value = Math.round(b.low+8+Math.sin(i*.28+j)*4+(i<72?Math.max(0,Math.sin(i*.05))*20:0));
  if(b.id==='north'&&overnight) value=scenario==='E'?0:Math.round(126+Math.sin(i*.7)*6);
  readings.push({id:`RD-${b.id}-${at}`,buildingId:b.id,at,value:scenario==='E'&&b.id==='north'&&overnight?null:value,quality:scenario==='E'&&b.id==='north'&&overnight?(i%2?'faulty':'missing'):'valid'});
 }
 const evidence:State['evidence']=[
 {id:'SCH-001',kind:'Schedule',text:scenario==='B'?'Approved deep cleaning, North Residence, 00:00–10:00. Expected flow 105–145 L/min.':'No scheduled overnight water use at North Residence. Occupancy 92%.',at:START-86400000,buildingId:'north'},
 {id:'RPT-001',kind:'Resident report',text:scenario==='B'?'Cleaning crew seen in the north wing.': 'Continuous water sound near the ground-floor washroom since midnight.',at:START-1200000,buildingId:'north'},
 {id:'MNT-001',kind:'Maintenance',text:'Routine meter inspection 14 days ago; no known calibration issue. Previous cistern inspection 42 days ago.',at:START-14*86400000,buildingId:'north'}
 ];
 if(scenario==='F') evidence.push({id:'RPT-002',kind:'Resident report',text:'Same north washroom: running-water noise. Related location and observation window; linked to INC-1042.',at:START-900000,buildingId:'north'});
 return {revision:1,now:START,scenario,running:false,lastTick:Date.now(),buildings,readings,evidence,
 incidents:[{id:'INC-1042',buildingId:'north',title:scenario==='E'?'Telemetry gap needs investigation':'Unusual overnight consumption',state:'Detected',detectedAt:START-45*60000,evidenceVersion:1,collected:[],evidenceIds:[],plan:'Review readings and operational context before recommending an inspection.',questions:['Is the meter reliable?','Could scheduled activity explain the flow?'],hypothesis:'Insufficient information',cycle:1}],
 workOrders:[],technicians:[{id:'tech-ravi',name:'Ravi Shah',initials:'RS',specialty:'Plumbing & water systems',available:true},{id:'tech-maya',name:'Maya Iyer',initials:'MI',specialty:'Facilities & metering',available:true},{id:'tech-james',name:'James Cole',initials:'JC',specialty:'Electrical systems',available:false}],traces:[],runs:[],requests:[],audit:[],completedCommands:[]};
}
