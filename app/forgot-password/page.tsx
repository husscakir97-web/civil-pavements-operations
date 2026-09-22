'use client';
import {useState} from 'react';
import {authClient} from '@/lib/platform/auth-client';
export default function ForgotPassword(){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 return <main className="mx-auto max-w-md p-8"><h1 className="text-2xl font-bold">Reset your password</h1><form className="my-6 grid gap-4" onSubmit={async e=>{
  e.preventDefault();setBusy(true);setMessage('');const email=String(new FormData(e.currentTarget).get('email'));
  try{const result=await authClient.requestPasswordReset({email,redirectTo:'/reset-password'});setMessage(result.error?.message||'If this email has an account, a reset link has been sent. Check your inbox and spam folder.');}catch{setMessage('Unable to connect. Please retry.');}finally{setBusy(false);}
 }}><label>Email<input className="w-full border p-2" type="email" name="email" autoComplete="email" required/></label><button className="rounded bg-orange-600 p-3 text-white" disabled={busy}>{busy?'Sending…':'Send reset link'}</button></form><p role="status">{message}</p><a className="mt-4 inline-block underline" href="/login">Back to sign in</a></main>;
}
