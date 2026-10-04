import type { Metadata } from 'next';
import Arc from '@/views/Arc.tsx';

export const metadata: Metadata = { title: 'Get USDC on Arc', description: 'Bring USDC to Arc from another chain, swap ETH or USDT into it, or withdraw it from an exchange. Powered by Circle App Kit.' };
export default function Page() { return <Arc />; }
