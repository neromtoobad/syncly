// Dry-run fixtures for Product Photo Studio: Adunni Naturals' whipped shea body butter, a 250 g white jar
// with a gold lid and a cream label. Photo 1 is a straight-on shot, photo 2 a view from above with the lid
// off, and photo 3 (when there is one) is too blurry, so the Analyst must set it aside. The checker catches
// a misspelt label on shot 3's first try (it must be remade with the stricter prompt) and passes the rest.
import type { Answers, Fingerprint, Slots } from './product-photos.ts';

const front: Fingerprint = {
  product: 'a 250 g white plastic jar of whipped shea body butter with a gold screw lid',
  count: 1,
  text: ['ADUNNI NATURALS', 'Whipped Shea Body Butter', 'Coconut & Vanilla', '250 g / 8.8 oz'],
  colours: ['white jar', 'shiny gold lid', 'cream label', 'dark green lettering', 'a small gold leaf mark above the name'],
  shape: 'a short, wide round jar, about one and a half times as wide as it is tall; the lid is about a third of the total height',
  material: 'smooth white plastic jar, glossy metallic gold lid, matte paper label',
  angle: 'straight on, at eye level',
  category: 'skincare',
  sharp: 'yes', whole: 'yes', single: 'yes', big: 'yes', lit: 'yes',
  notes: 'slight glare on the lid',
};

const open: Fingerprint = {
  ...front,
  product: 'the same 250 g white jar of whipped shea body butter, lid off and leaning against it, showing the cream inside',
  text: ['ADUNNI NATURALS', 'Whipped Shea Body Butter', '250 g / 8.8 oz'],
  colours: ['white jar', 'ivory whipped cream with soft peaks', 'gold lid', 'cream label', 'dark green lettering'],
  angle: 'three-quarter view from slightly above',
  notes: '',
};

const blurry: Fingerprint = {
  ...front,
  text: ['[unreadable]'],
  angle: 'straight on, at eye level',
  sharp: 'no', lit: 'no',
  notes: 'the photo is too blurry to read the label',
};

export const fingerprint = (i: number): Fingerprint => [front, open, blurry][Math.min(i, 2)];

export const slots = (): Slots => ({
  surface: 'a pale travertine stone slab',
  backdrop: 'warm off-white plaster',
  setting: 'on a bathroom shelf beside a folded white towel',
  setting2: 'on a dressing table in soft morning light',
  setting3: 'on a sunlit windowsill with palm leaf shadows',
  surface2: 'a folded ankara cloth',
  props: ['a sprig of eucalyptus', 'raw shea nuts in a small wooden bowl'],
});

const pass: Answers = { same_product: 'yes', text_same: 'yes', colours_same: 'yes', shape_same: 'yes', whole: 'yes', added_marks: 'no', distorted: 'no', scene_ok: 'yes', notes: '' };

export const check = (shot: number, attempt: number): Answers =>
  shot === 3 && attempt === 1
    ? { ...pass, text_same: 'no', notes: 'the label reads "Whiped Shea Body Butter"; the original says "Whipped"' }
    : pass;
