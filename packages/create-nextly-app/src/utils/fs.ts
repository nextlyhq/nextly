/**
 * File system utilities - wrappers around fs-extra for convenience
 */
import fs from "fs-extra";

export async function ensureDir(path: string): Promise<void> {
  return fs.ensureDir(path);
}

export async function pathExists(path: string): Promise<boolean> {
  return fs.pathExists(path);
}

export async function readJson<T = unknown>(file: string): Promise<T> {
  return fs.readJson(file) as Promise<T>;
}

export async function writeFile(
  file: string,
  data: string,
  encoding?: BufferEncoding
): Promise<void> {
  return fs.writeFile(file, data, encoding);
}

export async function appendFile(
  file: string,
  data: string,
  encoding?: BufferEncoding
): Promise<void> {
  return fs.appendFile(file, data, encoding);
}

export async function readFile(
  file: string,
  encoding: BufferEncoding
): Promise<string> {
  return fs.readFile(file, encoding);
}
