import type { Metadata } from 'next';
import SiteEditor from '@/views/SiteEditor.tsx';

// The private editor link from a website delivery email. Never indexed.
export const metadata: Metadata = { title: 'Edit your site', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SiteEditor token={token} />;
}
