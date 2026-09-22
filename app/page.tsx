import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {getAuth} from '@/lib/platform/auth';
import {PavementOS} from './pavement-os';
export const dynamic='force-dynamic';
export default async function Home(){const session=await getAuth().api.getSession({headers:await headers()});if(!session)redirect('/login');return <><nav className="flex justify-end gap-4 border-b px-4 py-2 text-sm"><a href="/account">Account & team</a></nav><PavementOS/></>}
