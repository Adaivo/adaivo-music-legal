import { mkdir, mkdtemp, readdir, rename, rm, rmdir, lstat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

async function listFiles(root, relative = "") {
  const output = [];
  for (const entry of await readdir(resolve(root, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await listFiles(root, next));
    else if (entry.isFile()) output.push(next);
    else throw new Error(`staging output must contain regular files: ${next}`);
  }
  return output.sort();
}

async function ensureDirectory(directory, boundary, created) {
  const missing = [];
  let current = directory;
  while (true) {
    try {
      if (!(await lstat(current)).isDirectory()) throw new Error(`output parent is not a directory: ${current}`);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing.push(current);
      if (current === boundary) break;
      current = dirname(current);
    }
  }
  for (const path of missing.reverse()) {
    await mkdir(path);
    created.push(path);
  }
}

async function removeEmptyDirectories(paths) {
  for (const path of [...paths].reverse()) {
    try {
      await rmdir(path);
    } catch (error) {
      if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error;
    }
  }
}

export async function writeTransactionally(outputRoot, writeStagedOutput) {
  const parent = dirname(outputRoot);
  const stage = await mkdtemp(resolve(parent, `.${basename(outputRoot)}.staging-`));
  const backupRoot = resolve(stage, ".backup");
  try {
    await writeStagedOutput(stage);
    const files = await listFiles(stage);
    const createdDirectories = [];
    const committed = [];
    try {
      for (const relative of files) {
        const source = resolve(stage, relative);
        const destination = resolve(outputRoot, relative);
        if (!(await lstat(source)).isFile()) throw new Error(`staging output must contain regular files: ${relative}`);
        await ensureDirectory(dirname(destination), parent, createdDirectories);
        const backup = resolve(backupRoot, relative);
        let previous = false;
        try {
          if (!(await lstat(destination)).isFile()) throw new Error(`transaction destination must be a regular file: ${relative}`);
          previous = true;
          await ensureDirectory(dirname(backup), stage, []);
          await rename(destination, backup);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        const record = { destination, backup, previous };
        committed.push(record);
        await rename(source, destination);
      }
    } catch (error) {
      for (const { destination, backup, previous } of committed.reverse()) {
        await rm(destination, { recursive: true, force: true });
        if (previous) {
          await ensureDirectory(dirname(destination), parent, createdDirectories);
          await rename(backup, destination);
        }
      }
      await removeEmptyDirectories(createdDirectories);
      throw error;
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
