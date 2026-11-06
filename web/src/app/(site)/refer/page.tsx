import type { Metadata } from 'next';
import Refer from '@/views/Refer.tsx';

export const metadata: Metadata = { title: 'Refer a business', description: 'Send a business your Syncly promo code: their first job is free, and when they accept the work, your next job is free too.' };
export default function Page() { return <Refer />; }
