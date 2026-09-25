import {verifySignature,billingEvent,applyBillingEvent,billingConfigured} from '@/lib/platform/billing';
export const dynamic='force-dynamic';
// Public endpoint for the billing provider. Nothing is stored unless the signature verifies.
export async function POST(request:Request){
 if(!billingConfigured())return Response.json({error:'Billing is not configured.'},{status:503});
 const provider=process.env.BILLING_PROVIDER!,raw=await request.text();
 if(raw.length>256_000)return Response.json({error:'Payload too large.'},{status:413});
 if(!verifySignature(process.env.BILLING_WEBHOOK_SECRET,raw,request.headers.get('x-billing-signature'))){console.warn('Billing webhook rejected: invalid signature');return Response.json({error:'Invalid signature.'},{status:401});}
 let parsed;try{parsed=billingEvent.safeParse(JSON.parse(raw));}catch{return Response.json({error:'Invalid JSON.'},{status:400});}
 if(!parsed.success)return Response.json({error:'Unrecognised billing event.'},{status:400});
 try{const r=await applyBillingEvent(provider,parsed.data,raw);return Response.json({received:true,duplicate:r.duplicate});}
 catch(e){const status=Number((e as {status?:number}).status)||500;if(status>=500)console.error('Billing webhook failed',e);return Response.json({error:status>=500?'Processing failed; the provider should retry.':(e as Error).message},{status});}
}
