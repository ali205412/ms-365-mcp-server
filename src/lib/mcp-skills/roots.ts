import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const RootUriZod = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => value.startsWith('file://'), {
    message: 'Only local file:// roots are supported.',
  });
const RelativePathZod = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !path.isAbsolute(value), { message: 'Path must be relative to the root.' })
  .refine((value) => !value.split(/[\\/]+/).includes('..'), {
    message: 'Path must not traverse outside the root.',
  });

export const SkillPackRootFileZod = z
  .object({
    rootUri: RootUriZod,
    path: RelativePathZod,
  })
  .strict();

export type SkillPackRootFile = z.infer<typeof SkillPackRootFileZod>;

export interface SkillPackRootWriteResult {
  readonly rootUri: string;
  readonly path: string;
  readonly bytes: number;
}

function rootPath(rootUri: string): string {
  const url = new URL(rootUri);
  if (url.protocol !== 'file:') throw new Error('Only file:// roots are supported.');
  return fileURLToPath(url);
}

function resolveInsideRoot(input: SkillPackRootFile): string {
  const parsed = SkillPackRootFileZod.parse(input);
  const root = path.resolve(rootPath(parsed.rootUri));
  const target = path.resolve(root, parsed.path);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Skill pack path escapes the declared root.');
  }
  return target;
}

export async function readSkillPackFromRoot(input: SkillPackRootFile): Promise<unknown> {
  const filePath = resolveInsideRoot(input);
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text) as unknown;
}

export async function writeSkillPackToRoot(
  input: SkillPackRootFile,
  pack: unknown
): Promise<SkillPackRootWriteResult> {
  const filePath = resolveInsideRoot(input);
  const text = `${JSON.stringify(pack, null, 2)}\n`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, { encoding: 'utf8', mode: 0o600 });
  return { ...input, bytes: Buffer.byteLength(text, 'utf8') };
}
