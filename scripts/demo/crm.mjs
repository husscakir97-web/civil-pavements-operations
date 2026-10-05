// Clients, contacts and sites (Core client master). Fictional organisations; non-deliverable contact details.
export const CLIENTS=[
 {code:'DEMO-C1',name:'Marrow Shire Council',terms:30,sites:[['Marrow Shire Depot','12 Depot Road, Marrow NSW 2999'],['Quarry Road corridor','Quarry Road, Marrow NSW 2999']],contacts:[['Helen Park','Roads Engineer','helen.park'],['Greg Tan','Procurement Officer','greg.tan']]},
 {code:'DEMO-C2',name:'Ridgeway City Council',terms:30,sites:[['Anzac Parade','Anzac Parade, Ridgeway NSW 2998'],['Stage 2 Rehab precinct','Mill Street, Ridgeway NSW 2998']],contacts:[['Priscilla Dunn','Senior Project Officer','priscilla.dunn']]},
 {code:'DEMO-C3',name:'Ironbark Construction Pty Ltd',terms:45,sites:[['Eastlink Industrial Estate','40 Foundry Way, Exampleton NSW 2999']],contacts:[['Marcus Iyer','Construction Manager','marcus.iyer'],['Tess Howell','Site Administrator','tess.howell']]},
 {code:'DEMO-C4',name:'Coastal Tollways Pty Ltd',terms:30,sites:[['Coastal Motorway night works','Coastal Motorway, Exampleton NSW 2999']],contacts:[['Andre Silva','Operations Manager','andre.silva']]},
];
const mail=l=>`${l}@demo-client.example.invalid`;

export async function crmStage(c){
 const {call,must,one,org,log}=c;
 for(const k of CLIENTS){
  let row=await one('SELECT id FROM clients WHERE organisation_id=? AND client_code=?',[org,k.code]);
  if(!row){
   const [s0,a0]=k.sites[0],[n0,r0,m0]=k.contacts[0];
   await must(call('/api/platform/clients','POST',{action:'create',client:{name:k.name,clientCode:k.code,contactName:n0,email:mail(m0),phone:'0400 000 400',paymentTermsDays:k.terms,site:{name:s0,address:a0},contact:{name:n0,email:mail(m0),phone:'0400 000 400',role:r0}}}),[200,201],'client '+k.code);
   row=await one('SELECT id FROM clients WHERE organisation_id=? AND client_code=?',[org,k.code]);c.note('clients');
  }
  c.ids['client:'+k.code]=row.id;
  for(const [name,address] of k.sites){
   let s=await one('SELECT id FROM client_sites WHERE organisation_id=? AND client_id=? AND name=?',[org,row.id,name]);
   if(!s){await must(call('/api/platform/clients','POST',{action:'createSite',site:{clientId:row.id,name,address}}),[200,201],'site '+name);s=await one('SELECT id FROM client_sites WHERE organisation_id=? AND client_id=? AND name=?',[org,row.id,name]);c.note('sites');}
   c.ids[`site:${k.code}:${name}`]=s.id;
  }
  for(const [name,role,m] of k.contacts){
   let p=await one('SELECT id FROM client_contacts WHERE organisation_id=? AND client_id=? AND name=?',[org,row.id,name]);
   if(!p){await must(call('/api/platform/clients','POST',{action:'addContact',clientId:row.id,contact:{name,role,email:mail(m),phone:'0400 000 401'}}),[200,201],'contact '+name);p=await one('SELECT id FROM client_contacts WHERE organisation_id=? AND client_id=? AND name=?',[org,row.id,name]);c.note('contacts');}
   c.ids[`contact:${k.code}:${name}`]=p.id;
  }
 }
 log('clients',(await one('SELECT COUNT(*) n FROM clients WHERE organisation_id=?',[org])).n,'sites',(await one('SELECT COUNT(*) n FROM client_sites WHERE organisation_id=?',[org])).n,'contacts',(await one('SELECT COUNT(*) n FROM client_contacts WHERE organisation_id=?',[org])).n);
}
