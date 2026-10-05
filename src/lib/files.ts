import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Shape of the file objects sevdesk returns for PDF/XML downloads. */
interface SevdeskFile {
  filename?: string;
  mimetype?: string;
  content?: string;
  base64Encoded?: boolean;
}

/**
 * Large base64 blobs cost a lot of context. When an outputPath is given the file is written
 * to disk and only its location is returned.
 */
export async function deliverFile(file: unknown, outputPath?: string): Promise<unknown> {
  if (!outputPath) return file;

  const { filename, mimetype, content, base64Encoded } = (file ?? {}) as SevdeskFile;
  if (typeof content !== "string") {
    throw new Error("sevdesk returned no file content.");
  }

  const target = resolve(outputPath);
  const bytes = Buffer.from(content, base64Encoded === false ? "utf-8" : "base64");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);

  return { savedTo: target, filename, mimetype, bytes: bytes.length };
}
