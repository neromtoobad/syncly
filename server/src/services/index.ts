import { researchBrief } from './research-brief.ts';
import { localBusinessFinder } from './local-business-finder.ts';
import { leadList } from './lead-list.ts';
import { contentPack } from './content-pack.ts';
import { website } from './website.ts';
import { motionAd } from './motion-ad.ts';
import { videoAd } from './video-ad.ts';
import { aiAnswerAudit } from './ai-answer-audit.ts';
import { bestPrice } from './best-price.ts';
import { vendorCheck } from './vendor-check.ts';
import { adLaunch } from './ad-launch.ts';
import { productPhotos } from './product-photos.ts';
import { getFound } from './get-found.ts';
import { buySmart } from './buy-smart.ts';
import type { Job } from '../job.ts';
import type { BusinessDetails } from '../details.ts';

export type Runnable = { id: string; name: string; priceUsd: number; run: (brief: string, opts?: { orderId?: string; details?: BusinessDetails }) => Promise<Job> };

// Retired services stay runnable so an old order can still be revised.
export const SERVICES: Record<string, Runnable> = {
  [website.id]: website,
  [contentPack.id]: contentPack,
  [motionAd.id]: motionAd,
  [adLaunch.id]: adLaunch,
  [productPhotos.id]: productPhotos,
  [getFound.id]: getFound,
  [buySmart.id]: buySmart,
  [videoAd.id]: videoAd,
  [aiAnswerAudit.id]: aiAnswerAudit,
  [bestPrice.id]: bestPrice,
  [vendorCheck.id]: vendorCheck,
  [researchBrief.id]: researchBrief,
  [localBusinessFinder.id]: localBusinessFinder,
  [leadList.id]: leadList,
};

/** The menu: what a business would otherwise pay an agency or a freelancer for, plus research it can order in a sentence. */
export const CATALOG = [
  {
    // The free first website ran during launch week; it's off now, and FREE_FIRST_WEBSITE=1 turns it back on.
    id: 'website', name: 'Website', dept: 'Growth Studio', live: true, freeFirst: process.env.FREE_FIRST_WEBSITE === '1', priceUsd: 2, listedCostUsd: 0.7, etaMin: 2,
    tagline: 'A designed site built from your Google listing and Instagram, live today.',
    youGet: ['A site in one of 7 designed themes, in a colour taken from your own photos, live at a link today', 'Your menu or prices, real Google reviews and your best photos (flyers are left out)', 'WhatsApp on every screen, live "open now" hours, map and directions', 'Every price and phone number checked against your sources; reviewed on a phone and a laptop', 'Search-ready, and the files to host anywhere with your own domain'],
    team: ['researcher', 'scout', 'reader', 'analyst', 'illustrator', 'auditor', 'messenger'],
    example: 'A website for Tolu’s Small Chops in Surulere, Lagos. WhatsApp 0803 555 0142, Instagram @tolussmallchops',
  },
  {
    id: 'content-pack', name: 'Content Pack', dept: 'Growth Studio', live: true, priceUsd: 2, listedCostUsd: 1.1, etaMin: 3,
    tagline: 'What is working in your niche this week, and 7 posts built on it.',
    youGet: ['The content styles pulling views in your niche right now, each backed by real posts and their numbers', 'What your own account shows: what worked and what didn’t', '7 posts in your voice: hook, caption, CTA, hashtags, shot list', '3 designed images, ready to post', 'Checked: every example is real, no invented claims'],
    team: ['researcher', 'reader', 'scout', 'analyst', 'writer', 'illustrator', 'auditor', 'messenger'],
    example: 'Content for Tolu’s Small Chops in Lagos, Instagram @tolussmallchops',
  },
  {
    id: 'ad-launch', name: 'Ad Launch', dept: 'Growth Studio', live: true, priceUsd: 2, listedCostUsd: 2.0, etaMin: 4,
    tagline: 'Ads that bring customers, not likes: creatives, a video, copy and a 7-day plan.',
    youGet: ['3 ad angles built on ads in your niche that have kept running for 30+ days', 'Feed and Story creatives for each, made from your own product photo', 'An 8 s video ad, and copy to paste for Instagram, Facebook and TikTok', 'Who to target, your budget split into a 7-day test, and step-by-step setup', 'Already boosting? Send a screenshot and we tell you what to change'],
    team: ['researcher', 'scout', 'analyst', 'writer', 'illustrator', 'producer', 'auditor', 'messenger'],
    example: 'Ads for Tolu’s Small Chops party trays, ₦25,000 for 20 guests, orders on WhatsApp 0803 555 0142, ₦5,000 a day',
  },
  {
    id: 'motion-ad', name: 'Motion Ad', dept: 'Growth Studio', live: true, priceUsd: 1, listedCostUsd: 0.9, etaMin: 4,
    tagline: 'A designer-grade motion video of your offer, with its own soundtrack.',
    youGet: ['A 12–24 s motion video, vertical for Reels, TikTok and Status (square or landscape on request)', 'Full-frame scenes of your products, your selling points and your call to action, cut on the beat', 'Your own photos, plus product pictures from your website', 'An original soundtrack composed from the video’s own timeline, no licensing', 'Every scene reviewed for legibility before rendering'],
    team: ['researcher', 'reader', 'producer', 'auditor', 'messenger'],
    example: 'A 16 second vertical ad for Tolu’s Small Chops: party trays, ₦25,000 for 20 guests, order on WhatsApp 0803 555 0142',
  },
  {
    id: 'product-photos', name: 'Product Photo Studio', dept: 'Growth Studio', live: true, priceUsd: 2, listedCostUsd: 1.1, etaMin: 3,
    tagline: 'Your phone photos of a product, turned into about 8 professional shots sized for where you sell.',
    youGet: ['About 8 shots from your own 1–3 photos, at exact sizes for Instagram, WhatsApp Status, Jumia, Jiji and Konga, and your website', 'Your product kept as it is: the label words, colours and shape are written down first, and every shot is held to them', 'Every shot checked beside your photo by a separate AI; one that changes your product is remade once, then left out', 'A before-and-after sheet, plus copies of your social shots with your own logo in the corner', 'All photos in one zip, with where to post each one'],
    team: ['analyst', 'illustrator', 'auditor', 'messenger'],
    example: 'Product photos of Adunni Naturals’ 250 g whipped shea body butter jar for Instagram, WhatsApp and Jumia, clean look',
  },
  {
    id: 'get-found', name: 'Get Found', dept: 'Growth Studio', live: true, priceUsd: 2, listedCostUsd: 3.0, etaMin: 4,
    tagline: 'Where you show up on Google Maps and in ChatGPT, who shows up instead, and what to fix first.',
    youGet: ['Your Google Maps position from 9 spots around your shop, for 2 searches customers really type, as a coloured map', 'You next to the 3 businesses that show above you most: rating, reviews, category, website, hours', 'Your Google profile checked line by line, with a new description and replies to your recent reviews, ready to paste', 'What ChatGPT, Gemini, Claude and Perplexity tell customers about you, every wrong fact quoted word for word', 'One fix list, most urgent first, checked by an independent auditor on a different AI model'],
    team: ['researcher', 'scout', 'reader', 'investigator', 'analyst', 'writer', 'auditor', 'messenger'],
    example: 'Mama Put Kitchen, a restaurant in Yaba, Lagos. Website mamaputkitchen.ng. Customers search "jollof rice yaba"',
  },
  {
    id: 'buy-smart', name: 'Buy Smart', dept: 'Buying & Suppliers', live: true, priceUsd: 2, listedCostUsd: 0.7, etaMin: 3,
    tagline: 'Where to buy it cheapest, delivered, and whether the seller is safe to pay.',
    youGet: ['Best pick and runner-up for up to 5 items, with the delivered total in your currency', 'Every price re-checked on the seller’s own page, with stock and delivery fee', 'A RED / AMBER / GREEN check on up to 3 sellers: the ones you’re talking to, and any pick from a classified ad or a shop we don’t know', 'Every signal cited, what to ask each seller, and how to pay safely', 'A spreadsheet of every offer and the raw seller signals, emailed to you'],
    team: ['researcher', 'scout', 'reader', 'analyst', 'investigator', 'writer', 'auditor', 'messenger'],
    example: '2 chest freezers (300 L) and a double-basket deep fryer, new, delivered to Surulere, Lagos. Budget ₦900k. Also talking to @frostking_ng on Instagram',
  },
  {
    id: 'local-business-finder', name: 'Local Business Finder', dept: 'Research', live: true, priceUsd: 1, listedCostUsd: 0.2, etaMin: 2,
    tagline: 'Every business of a type in an area, with phone, website and rating.',
    youGet: ['A clean spreadsheet (CSV) of up to 60 businesses', 'Phone numbers normalised to +234', 'Filters like "no website" or "has a phone"', 'Checked by rules: no duplicates, every row complete, filter holds', 'Emailed to you with the spreadsheet attached'],
    team: ['researcher', 'scout', 'investigator', 'analyst', 'auditor', 'messenger'],
    example: 'Every café and coffee shop in Lekki Phase 1 that has no website',
  },
  {
    id: 'lead-list', name: 'Lead List', dept: 'Research', live: true, priceUsd: 1, listedCostUsd: 0.5, etaMin: 3,
    tagline: 'Up to 25 verified business emails, each with a personalised first line.',
    youGet: ['Up to 25 leads with emails that passed a live deliverability check', 'Where each email came from (their own site or a finder)', 'One opening line per lead, written from real data', 'You send; we never cold-email for you', 'Emailed to you with the spreadsheet attached'],
    team: ['researcher', 'scout', 'reader', 'investigator', 'writer', 'auditor', 'messenger'],
    example: '25 boutique hotels in Victoria Island, Lagos, for my bakery\'s weekly pastry delivery',
  },
  {
    id: 'research-brief', name: 'Research Brief', dept: 'Research', live: true, priceUsd: 1, listedCostUsd: 0.3, etaMin: 2,
    tagline: 'Competitors, market and pricing, with every claim cited.',
    youGet: ['A 600–900 word brief with a 3-point summary', 'Every factual claim cited to a source you can open', 'Concrete recommendations', 'Checked by an independent auditor on a different AI model', 'Emailed to you when it is done'],
    team: ['researcher', 'scout', 'reader', 'auditor', 'writer', 'messenger'],
    example: 'Competitors and pricing for a small bakery in Lekki, Lagos that wants to add cake delivery',
  },
] as const;

/** Services we no longer offer. Their past jobs still show on the job pages and in the books. */
export const RETIRED = [
  {
    id: 'ai-answer-audit', name: 'AI Answer Audit', dept: 'Growth Studio', live: false, priceUsd: 15, listedCostUsd: 3.0, etaMin: 10,
    tagline: 'What ChatGPT, Gemini, Claude and Perplexity tell your customers about you, and what they get wrong.',
    youGet: ['24 real answers: 6 customer questions put to ChatGPT, Gemini, Claude and Perplexity with web search on', 'Every wrong fact quoted word for word next to your real hours, prices and details', 'Who the AIs recommend instead of you, and the pages they cite', 'A prioritised fix list, checked by an independent auditor on a different AI model', 'Emailed to you with a spreadsheet of every answer'],
    team: ['researcher', 'scout', 'reader', 'investigator', 'analyst', 'auditor', 'writer', 'messenger'],
    example: 'Mama Put Kitchen, a restaurant in Yaba, Lagos. Website mamaputkitchen.ng',
  },
  {
    id: 'video-ad', name: 'Video Ad', dept: 'Growth Studio', live: false, priceUsd: 15, listedCostUsd: 1.8, etaMin: 8,
    tagline: 'Your product photo, turned into an 8 s video ad with copy to paste.',
    youGet: ['An 8 s ad in 9:16 and 1:1, from your own product photo', 'A hook on screen, an end card with your call to action, and music', 'Hooks, primary text and headlines for Meta and TikTok', 'A still key visual that works as an image ad', 'Checked: no invented claims, frames reviewed before delivery'],
    team: ['researcher', 'scout', 'illustrator', 'producer', 'writer', 'auditor', 'messenger'],
    example: 'Video ad for my small chops party trays, ₦25,000 for 20 guests, order on WhatsApp 0803 555 0142. Photo: https://…',
  },
  {
    id: 'best-price', name: 'Best Price Finder', dept: 'Buying & Suppliers', live: false, priceUsd: 3, listedCostUsd: 0.15, etaMin: 5,
    tagline: 'Where to buy it cheapest, delivered, from a seller you can trust.',
    youGet: ['Best pick and runner-up for up to 5 items, with the delivered total in your currency', 'Prices re-checked on each seller’s own page, with stock and delivery fee', 'Scam flags: too-good-to-be-true prices, unknown sellers, bank-transfer-only pages', 'Checked by an independent auditor on a different AI model', 'A spreadsheet (CSV) of every offer we found, emailed to you'],
    team: ['researcher', 'scout', 'analyst', 'reader', 'auditor', 'writer', 'messenger'],
    example: 'Two Samsung Galaxy A16 phones, new, delivered to Lekki, Lagos. Budget ₦400k',
  },
  {
    id: 'vendor-check', name: 'Check Before You Pay', dept: 'Buying & Suppliers', live: false, priceUsd: 4, listedCostUsd: 0.5, etaMin: 4,
    tagline: 'About to pay a supplier or vendor upfront? Red, amber or green before the money leaves.',
    youGet: ['A RED / AMBER / GREEN verdict from fixed rules, with the rule that fired', 'Every signal cited: phone fraud checks, domain age, Google Maps, scam reports on Nairaland and Reddit, Instagram history', 'Sanctions screening when $500 or more is at stake', 'What to ask them before paying, and how to pay safely', 'Raw signals as a JSON file, emailed to you'],
    team: ['investigator', 'scout', 'reader', 'analyst', 'writer', 'auditor', 'messenger'],
    example: 'I want to pay ₦850,000 upfront to Gadget Plug NG for 5 iPhone 13s. Instagram @gadgetplug_ng, phone 0803 123 4567, shop in Computer Village Ikeja',
  },
] as const;

export type CatalogItem = (typeof CATALOG)[number] | (typeof RETIRED)[number];
/** Any service, current or retired, for showing an old order. */
export const findService = (id: string): CatalogItem | undefined => CATALOG.find((c) => c.id === id) ?? RETIRED.find((c) => c.id === id);
