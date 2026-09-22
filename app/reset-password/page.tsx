'use client';
import {useState} from 'react';
import {authClient} from '@/lib/platform/auth-client';
export default function ResetPassword(){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 return <main className="mx-auto max-w-md p-8"><h1 className="text-2xl font-bold">Choose a new password</h1>{!done&&<form className="my-6 grid gap-4" onSubmit={async e=>{
  e.preventDefault();setMessage('');const data=new FormData(e.currentTarget),newPassword=String(data.get('password')),token=new URLSearchParams(window.location.search).get('token');
  if(!token){setMessage('This reset link is invalid or expired. Request a new link.');return;}
  if(newPassword!==data.get('confirm')){setMessage('The passwords do not match.');return;}
  setBusy(true);try{const result=await authClient.resetPassword({newPassword,token});if(result.error)setMessage(result.error.message||'This link has expired. Request another reset link.');else{setDone(true);setMessage('Password updated. Sign in with your new password.');}}catch{setMessage('Unable to connect. Please retry.');}finally{setBusy(false);}
 }}><label>New password<input className="w-full border p-2" name="password" type="password" autoComplete="new-password" minLength={12} required/></label><label>Confirm password<input className="w-full border p-2" name="confirm" type="password" autoComplete="new-password" minLength={12} required/></label><button className="rounded bg-orange-600 p-3 text-white" disabled={busy}>{busy?'Saving…':'Save new password'}</button></form>}<p role="status">{message}</p><p className="mt-4"><a className="underline" href="/login">Sign in</a> · <a className="underline" href="/forgot-password">Request another reset link</a></p></main>;
}
