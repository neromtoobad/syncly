// Themes for customer sites. Each is a fixed personality: a font pairing (both checked to include the
// naira sign and Yoruba letters ẹ ọ ṣ), how headings and labels behave, corner radii, and whether the
// page is light, warm or dark. The model picks a theme by name; it never writes CSS.

export type ThemeId = 'atelier' | 'street' | 'salon' | 'studio' | 'clinic' | 'market' | 'lounge';

export type Theme = {
  id: ThemeId;
  mood: string; // what the model reads when choosing
  fits: string;
  fonts: string; // Google Fonts css2 query
  display: { family: string; weight: number; style?: 'italic' | 'normal'; tracking: string; leading: number; caps?: boolean; stretch?: string; accentItalic?: boolean };
  body: { family: string; weight: number };
  label: 'caps' | 'mono' | 'italic';
  mono?: string;
  mode: 'light' | 'warm' | 'dark';
  radius: { btn: string; card: string; img: string };
  rule: boolean; // hairline rules between blocks
  // 'ink': buttons and bands in near-black (near-white on dark) and the brand colour only as an accent, which keeps
  // editorial themes calm whatever colour the photos give; 'brand': buttons in the brand colour.
  action: 'brand' | 'ink';
};

export const THEMES: Record<ThemeId, Theme> = {
  atelier: {
    id: 'atelier', mood: 'editorial and warm: a soft serif with real character, cream paper, hairline rules, italic accents',
    fits: 'bakeries, caterers, restaurants, cafés, food brands, florists, makers',
    fonts: 'family=Fraunces:ital,opsz,wght@0,9..144,400..800;1,9..144,400..700&family=Work+Sans:wght@400;500;600',
    display: { family: "'Fraunces', Georgia, serif", weight: 560, tracking: '-0.025em', leading: 1.02 },
    body: { family: "'Work Sans', system-ui, sans-serif", weight: 400 },
    label: 'italic', mode: 'warm', radius: { btn: '999px', card: '6px', img: '4px' }, rule: true, action: 'brand',
  },
  street: {
    id: 'street', mood: 'bold and loud: an extended heavy grotesk, big blocks of brand colour, confident and youthful',
    fits: 'street food, grills, barbers, sneaker and fashion shops, gyms, event brands',
    fonts: 'family=Archivo:wdth,wght@62..125,400..900&family=Plus+Jakarta+Sans:wght@400;500;600;700',
    display: { family: "'Archivo', system-ui, sans-serif", weight: 850, tracking: '-0.02em', leading: 0.92, caps: true, stretch: '118%' },
    body: { family: "'Plus Jakarta Sans', system-ui, sans-serif", weight: 450 },
    label: 'caps', mode: 'light', radius: { btn: '14px', card: '18px', img: '16px' }, rule: false, action: 'brand',
  },
  salon: {
    id: 'salon', mood: 'elegant and airy: a fine high-contrast serif, light geometric text, lots of space, soft rounded images',
    fits: 'hair and beauty salons, spas, nail studios, bridal, fashion designers, wedding planners',
    fonts: 'family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Epilogue:wght@300;400;500;600',
    display: { family: "'Cormorant Garamond', Georgia, serif", weight: 500, tracking: '-0.01em', leading: 1.0, accentItalic: true },
    body: { family: "'Epilogue', system-ui, sans-serif", weight: 300 },
    label: 'caps', mode: 'light', radius: { btn: '999px', card: '24px', img: '28px' }, rule: false, action: 'ink',
  },
  studio: {
    id: 'studio', mood: 'minimal and photo-first: tight grotesk, monospace labels, sharp edges, the work does the talking',
    fits: 'photographers, videographers, designers, architects, galleries, creative studios',
    fonts: 'family=Space+Grotesk:wght@400;500;600;700&family=Work+Sans:wght@400;500;600&family=Space+Mono:wght@400;700',
    display: { family: "'Space Grotesk', system-ui, sans-serif", weight: 500, tracking: '-0.045em', leading: 0.98 },
    body: { family: "'Work Sans', system-ui, sans-serif", weight: 400 },
    label: 'caps', mono: "'Space Mono', ui-monospace, monospace", mode: 'light', radius: { btn: '0px', card: '0px', img: '0px' }, rule: true, action: 'ink',
  },
  clinic: {
    id: 'clinic', mood: 'calm and trustworthy: a readable serif for headings, a very legible sans, clean cards, nothing flashy',
    fits: 'clinics, pharmacies, dentists, labs, law and accounting firms, schools, consultants',
    fonts: 'family=Literata:ital,opsz,wght@0,7..72,400..800;1,7..72,400..600&family=Lexend:wght@300;400;500;600',
    display: { family: "'Literata', Georgia, serif", weight: 600, tracking: '-0.02em', leading: 1.08 },
    body: { family: "'Lexend', system-ui, sans-serif", weight: 350 },
    label: 'caps', mode: 'light', radius: { btn: '10px', card: '14px', img: '12px' }, rule: false, action: 'brand',
  },
  market: {
    id: 'market', mood: 'playful and bright: a round chunky display face, friendly colour, rounded everything',
    fits: 'kids and family businesses, snacks and drinks, phone and gadget shops, laundries, delivery services',
    fonts: 'family=Unbounded:wght@500;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700',
    display: { family: "'Unbounded', system-ui, sans-serif", weight: 700, tracking: '-0.035em', leading: 1.0 },
    body: { family: "'Plus Jakarta Sans', system-ui, sans-serif", weight: 450 },
    label: 'caps', mode: 'light', radius: { btn: '999px', card: '26px', img: '22px' }, rule: false, action: 'brand',
  },
  lounge: {
    id: 'lounge', mood: 'dark and luxurious: deep background, a refined serif with italics, warm highlights, night-time energy',
    fits: 'lounges, bars, fine dining, luxury fashion, perfume, nightlife, premium barbers',
    fonts: 'family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..600&family=Epilogue:wght@300;400;500;600',
    display: { family: "'Fraunces', Georgia, serif", weight: 400, tracking: '-0.03em', leading: 1.0, accentItalic: true },
    body: { family: "'Epilogue', system-ui, sans-serif", weight: 300 },
    label: 'caps', mode: 'dark', radius: { btn: '2px', card: '2px', img: '2px' }, rule: true, action: 'ink',
  },
};

/** One line per theme, for the model to choose from. */
export const themeMenu = () => Object.values(THEMES).map((t) => `- ${t.id}: ${t.mood}. Fits ${t.fits}.`).join('\n');
