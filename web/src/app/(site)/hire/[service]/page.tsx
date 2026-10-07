import type { Metadata } from 'next';
import Hire from '@/views/Hire.tsx';

const NAMES: Record<string, string> = { website: 'Business Website', 'content-pack': 'Social Media Posts', 'motion-ad': 'Promo Video', 'ad-launch': 'Ad Campaign', 'product-photos': 'Product Photos', 'get-found': 'Google Visibility Check', 'buy-smart': 'Best Price & Seller Check', 'video-ad': 'Video Ad', 'ai-answer-audit': 'AI Answer Audit', 'best-price': 'Best Price Finder', 'vendor-check': 'Check Before You Pay', 'research-brief': 'Market Research', 'find-customers': 'Find Customers', 'local-business-finder': 'Local Business Finder', 'lead-list': 'Lead List' };

export async function generateMetadata({ params }: { params: Promise<{ service: string }> }): Promise<Metadata> {
  const { service } = await params;
  return { title: `Hire: ${NAMES[service] ?? 'the team'}` };
}

export default async function Page({ params }: { params: Promise<{ service: string }> }) {
  const { service } = await params;
  return <Hire service={service} />;
}
