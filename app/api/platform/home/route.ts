import {api} from '@/lib/platform/http';
import {homeFeed} from '@/lib/seams/home';
export const dynamic='force-dynamic';
export const GET=api({permission:'field-read',module:'core'},async()=>homeFeed());
