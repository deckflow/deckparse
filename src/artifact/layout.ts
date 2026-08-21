import path from 'node:path';

/**
 * Artifact directory layout (docs/rfc.md §3.2, pdf.md §7.3). Public contract:
 *
 *   <artifact>/
 *   ├── ir.json          parse's only semantic output, server response verbatim
 *   ├── assets/          images, named by their persistent identity
 *   ├── manifest.json    written last — registered ⇒ exists
 *   └── views/<to>/      written only by convert; parse never touches it
 */
export const IR_FILE = 'ir.json';
export const MANIFEST_FILE = 'manifest.json';
export const ASSETS_DIR = 'assets';
export const VIEWS_DIR = 'views';

export function irPath(dir: string): string {
  return path.join(dir, IR_FILE);
}

export function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_FILE);
}

export function assetsDir(dir: string): string {
  return path.join(dir, ASSETS_DIR);
}

export function viewDir(dir: string, to: string): string {
  return path.join(dir, VIEWS_DIR, to);
}

/** Default artifact directory for a source document: sibling dir named after it. */
export function defaultArtifactDir(sourcePath: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return path.join(path.dirname(sourcePath), base);
}
