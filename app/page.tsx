import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {getAuth} from '@/lib/platform/auth';
import {PavementOS} from './pavement-os';
export const dynamic='force-dynamic';
export default async function Home(){const session=await getAuth().api.getSession({headers:await headers()});if(!session)redirect('/login');return <PavementOS/>}
