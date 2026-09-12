import { checked } from "./task-process.ts";

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
