import fs from "node:fs/promises";
import path from "node:path";

/**
 * Checks if a file exists at the given path
 * @param filePath The file path to check for existence
 * @returns true if the file exists, false otherwise
 */
export async function fileExists(filePath: string) {
  const file = Bun.file(filePath);

  if (await file.exists()) {
    return true;
  } else {
    return false;
  }
}

/**
 * Writes data to a file, creating directories as needed
 * @param filePath Path to the file to write
 * @param data data to write to the file
 */
export async function writeFile(filePath: string, data: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp.${path.basename(filePath)}.${Date.now()}`);
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, filePath);
}

/**
 * Rotates backups of a file and writes new data to it.
 * @param filePath Path to the file to write
 * @param data data to write to the file
 * @param maxBackups maximum number of backups to keep (default 3)
 */
export async function rotateWriteFile(
  filePath: string,
  data: string,
  maxBackups = 3,
) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  await fs.mkdir(dir, { recursive: true });

  const ext = path.extname(base);
  const name = base.slice(0, base.length - ext.length);

  const numbered = (n: number) => path.join(dir, `${name}.${n}${ext}`);
  const oldest = numbered(maxBackups);

  if (await fileExists(oldest)) {
    await fs.rm(oldest, { force: true });
  }

  for (let n = maxBackups - 1; n >= 1; n--) {
    const from = numbered(n);
    if (await fileExists(from)) {
      const to = numbered(n + 1);
      await fs.rename(from, to);
    }
  }

  if (await fileExists(filePath)) {
    await fs.rename(filePath, numbered(1));
  }

  await writeFile(filePath, data);
}

/**
 * Reads data from a file and assumes it is utf8 text
 * @param filePath Path to the file to read
 * @returns data read from the file
 */
export async function readFile(filePath: string) {
  return await fs.readFile(filePath, "utf8");
}
