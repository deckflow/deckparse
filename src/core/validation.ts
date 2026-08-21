import { DeckParseError } from '../errors/index.js';
import type { ConvertFlags, ParseFlags } from '../types.js';
import type { ResolvedInput } from './input.js';

/**
 * Flag × format validation (docs/rfc.md §5.2). A flag that cannot apply is a
 * usage error before any task is sent — the legacy backends silently ignored
 * unknown params, so the client is the only place this can be caught.
 */

type FormatKey = 'pdf' | 'pptx' | 'docx' | 'keynote' | 'link';

function formatOf(input: ResolvedInput): FormatKey | undefined {
  if (input.kind === 'link') {
    return 'link';
  }
  if (input.kind === 'artifact') {
    switch (input.manifest.parse.type) {
      case 'pdf.pdfParse':
        return 'pdf';
      case 'pptx.parse':
        return 'pptx';
      case 'docx.parseTextAndImage':
        return 'docx';
      case 'keynote.parseTextAndImage':
        return 'keynote';
      default:
        return 'link';
    }
  }
  switch (input.taskType) {
    case 'pdf.pdfParse':
      return 'pdf';
    case 'pptx.parse':
      return 'pptx';
    case 'docx.parseTextAndImage':
      return 'docx';
    case 'keynote.parseTextAndImage':
      return 'keynote';
  }
}

const PARSE_FLAG_FORMATS: Record<keyof ParseFlags, FormatKey[]> = {
  profile: ['pdf'],
  password: ['pdf'],
  includeImages: ['pdf'],
  stayImageAreaRate: ['keynote'],
  mode: ['link'],
};

const CONVERT_FLAG_FORMATS: Partial<Record<keyof ConvertFlags, FormatKey[]>> = {
  anchors: ['pdf'],
  splitPages: ['pptx', 'keynote'],
};

export function validateParseFlags(input: ResolvedInput, flags: ParseFlags): void {
  const format = formatOf(input);
  if (input.kind === 'artifact') {
    const set = Object.entries(flags).filter(([, value]) => value !== undefined);
    if (set.length > 0) {
      throw DeckParseError.usage(
        `Parse flags (${set.map(([name]) => `--${kebab(name)}`).join(', ')}) cannot apply to an artifact — it is already parsed.`
      );
    }
    return;
  }
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined) {
      continue;
    }
    const allowed = PARSE_FLAG_FORMATS[name as keyof ParseFlags];
    if (allowed && format && !allowed.includes(format)) {
      throw DeckParseError.usage(`--${kebab(name)} only applies to ${allowed.join('/')} input, not ${format}.`);
    }
  }
}

export function validateConvertFlags(input: ResolvedInput, flags: ConvertFlags): void {
  const format = formatOf(input);
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined || value === false) {
      continue;
    }
    const allowed = CONVERT_FLAG_FORMATS[name as keyof ConvertFlags];
    if (allowed && format && !allowed.includes(format)) {
      throw DeckParseError.usage(`--${kebab(name)} only applies to ${allowed.join('/')} input, not ${format}.`);
    }
  }
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
