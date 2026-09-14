import { PavementOS } from "@/app/pavement-os";
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home(){
  const user = await getChatGPTUser();
  if (!user) return <main className="mx-auto max-w-lg p-8"><h1 className="text-2xl font-bold">Reconnect your ChatGPT session</h1><p className="my-4">Your session is missing the identity required to load company records. Your saved data has not been deleted.</p><a className="inline-block rounded bg-orange-600 px-4 py-3 text-white" href={chatGPTSignInPath('/')} target="_top">Sign in with ChatGPT</a><p className="mt-4 text-sm">If this continues after signing in, open the Site in your regular browser and report the sign-in issue. Access checks remain enabled.</p></main>;
  return <PavementOS/>;
}
