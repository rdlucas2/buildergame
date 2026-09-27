import type { ZodError } from 'zod';

/** Thrown when a structure or world file cannot be read. The message is safe to show to players. */
export class FileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileFormatError';
  }
}

export function formatZodError(kind: string, err: ZodError): string {
  const lines = err.issues.slice(0, 5).map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
  const more = err.issues.length > 5 ? ` (+${err.issues.length - 5} more)` : '';
  return `Invalid ${kind} file: ${lines.join('; ')}${more}`;
}

export function parseJsonText(text: string, kind: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FileFormatError(`Invalid ${kind} file: not valid JSON (${(e as Error).message})`);
  }
}
