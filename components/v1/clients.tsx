'use client';
// Clients page: the shared register (search, edit, audit) plus each client's contacts.
import {useState} from 'react';
import {Sheet,SheetContent,SheetDescription,SheetTitle} from '@/components/ui/sheet';
import {RegisterView} from './register-view';
import {ClientContacts} from './lookup';
import {Btn} from './kit';

export function ClientsArea(){
 const [open,setOpen]=useState<{id:string;name:string}|null>(null);
 return <>
  <RegisterView register="clients" description="Create each client once. Opportunities, tenders and projects select them instead of retyping. Clients in use are marked inactive rather than deleted."
   rowActions={r=><Btn variant="secondary" className="min-h-9 px-3 text-sm" onClick={()=>setOpen({id:r.id,name:String(r.name||'Client')})}>Contacts</Btn>}/>
  <Sheet open={Boolean(open)} onOpenChange={o=>{if(!o)setOpen(null);}}>
   <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
    <SheetTitle className="border-b px-5 py-4 text-lg font-semibold">{open?.name} · contacts</SheetTitle>
    <SheetDescription className="sr-only">Client contacts</SheetDescription>
    <div className="p-5">{open&&<ClientContacts clientId={open.id}/>}</div>
   </SheetContent>
  </Sheet>
 </>;
}
