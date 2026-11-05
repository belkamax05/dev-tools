import ansiToHtml from './ansiToHtml';
import ansiToPng from './ansiToPng';
import mdToPdf from './mdToPdf';
import type { Converter } from './types';

/** Every converter convi knows. A new one is a folder next to `mdToPdf/` plus a line here. */
const converters: Converter[] = [mdToPdf, ansiToPng, ansiToHtml];

export default converters;
