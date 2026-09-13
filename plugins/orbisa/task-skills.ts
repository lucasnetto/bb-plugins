import { z } from "zod";
import { errorCodeSchema } from "./task-boundaries.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checked } from "./task-process.ts";

const manifestSchema = z.object({ roots: z.array(z.string()), signature: z.string() });

const receiptSchema = z.object({
  signature: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number(),
  mtime: z.number(),
});

// Hash what will actually be extracted, including permissions, but excluding
// timestamps, archive ordering, uid/gid and other packaging metadata.
export async function skillArchiveFingerprint(archive: string, signal: AbortSignal) {
  return (
    await checked(
      [
        "python3",
        "-c",
        String.raw`
import hashlib,json,sys,tarfile
h=hashlib.sha256()
with tarfile.open(sys.argv[1]) as tar:
    for entry in sorted(tar.getmembers(),key=lambda e:e.name):
        regular=entry.isfile() or entry.islnk()
        if not (regular or entry.isdir()): raise RuntimeError('Unsupported skill archive entry')
        content=hashlib.sha256()
        if regular:
            with tar.extractfile(entry) as f:
                for chunk in iter(lambda:f.read(1048576),b''): content.update(chunk)
        h.update(json.dumps([entry.name,'file' if regular else 'dir',entry.mode,content.hexdigest() if regular else ''],separators=(',',':')).encode())
        h.update(b'\0')
print(h.hexdigest())
`,
        archive,
      ],
      { signal },
    )
  ).trim();
}

// The base build lock serializes callers. Metadata is only a fast invalidation
// check; the base identity still comes from the archive's semantic content hash.
export async function cachedSkillArchive(home: string, signal: AbortSignal, cacheDir?: string) {
  const cache =
    cacheDir ??
    join(
      tmpdir(),
      `orbisa-skills-${createHash("sha256").update(home).digest("hex").slice(0, 16)}`,
    );

  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archive = join(cache, "skills.tar");
  const receipt = join(cache, "receipt.json");

  const manifest = async () =>
    manifestSchema.parse(
      JSON.parse(
        await checked(
          [
            "python3",
            "-c",
            String.raw`
import hashlib,json,os,pathlib,stat,sys
home=pathlib.Path(sys.argv[1]); rows=[]; roots=[]
def walk(path,logical,parents):
    s=path.stat(); identity=(s.st_dev,s.st_ino)
    rows.append([logical,str(path.resolve()),s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns])
    if stat.S_ISDIR(s.st_mode):
        if identity in parents: raise RuntimeError('Skill symlink cycle')
        for name in sorted(os.listdir(path)): walk(path/name,logical+'/'+name,parents|{identity})
    elif not stat.S_ISREG(s.st_mode): raise RuntimeError('Unsupported skill file')
for root in ['.cursor/skills','.agents/skills','.claude/skills','.codex/skills']:
    path=home/root
    if not path.exists():
        if path.is_symlink(): raise RuntimeError('Broken skill symlink')
        rows.append([root,'missing']); continue
    roots.append(root); walk(path,root,set())
print(json.dumps({'roots':roots,'signature':hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest()}))
`,
            home,
          ],
          { signal },
        ),
      ),
    );

  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await manifest();

    if (!before.roots.length)
      return { archive: undefined, digest: createHash("sha256").digest("hex") };

    try {
      const saved = receiptSchema.safeParse(JSON.parse(await readFile(receipt, "utf8"))).data;
      const file = await stat(archive);

      if (
        saved?.signature === before.signature &&
        saved.size === file.size &&
        saved.mtime === file.mtimeMs
      )
        return { archive, digest: saved.digest };
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        errorCodeSchema.safeParse(error).data?.code !== "ENOENT"
      )
        throw error;
    }

    const pending = join(cache, "skills.pending.tar");

    try {
      await checked(["tar", "-chf", pending, "-C", home, ...before.roots], { signal });
      const digest = await skillArchiveFingerprint(pending, signal);

      if ((await manifest()).signature !== before.signature) continue;
      await rename(pending, archive);
      const file = await stat(archive);
      await writeFile(
        join(cache, "receipt.pending.json"),
        JSON.stringify({
          signature: before.signature,
          digest,
          size: file.size,
          mtime: file.mtimeMs,
        }),
        { mode: 0o600 },
      );
      await rename(join(cache, "receipt.pending.json"), receipt);

      return { archive, digest };
    } finally {
      await rm(pending, { force: true });
    }
  }

  throw new Error("Skills changed repeatedly while preparing the archive; retry.");
}
