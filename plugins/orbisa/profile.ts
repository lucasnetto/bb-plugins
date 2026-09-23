import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { checked, command } from "./process.ts";

export async function prepareProfile(
  dataDir: string,
  guest: (command: string[], stdin?: string) => Promise<string>,
  signal: AbortSignal,
  report: (message: string) => void,
) {
  const profile = basename(dataDir) === ".bb-work" ? "work" : "personal";
  const optional = async (args: string[]) => {
    const result = await command(args, { signal }).catch(() => null);
    signal.throwIfAborted();
    return result?.exitCode === 0 ? result.stdout.trim() : null;
  };
  const [auth, versionText, github, aws, name, email, signing] = await Promise.all([
    readFile(join(homedir(), profile === "work" ? ".codex_work" : ".codex", "auth.json"), "utf8"),
    checked(["codex", "--version"], { signal }),
    checked(["gh", "auth", "token"], { signal }),
    optional(["aws", "configure", "export-credentials", "--format", "process"]),
    optional(["git", "config", "--global", "user.name"]),
    optional(["git", "config", "--global", "user.email"]),
    readFile(
      process.env.ORBISA_SIGNING_KEY ?? join(homedir(), ".config/orbisa/signing_key"),
      "utf8",
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
  ]);
  const version = versionText.match(/^codex-cli (\d+\.\d+\.\d+)/)?.[1];
  if (!version) throw new Error("Cannot determine the server's Codex version.");
  JSON.parse(auth);
  report(`Preparing Codex ${version} and ${profile} credentials`);
  await guest([
    "sh",
    "-ec",
    `test "$(codex --version 2>/dev/null)" = "codex-cli ${version}" || npm install -g @openai/codex@${version}`,
  ]);
  await guest(
    ["python3", "-c", INSTALL_PROFILE],
    JSON.stringify({
      auth,
      github: github.trim(),
      aws: aws ? JSON.parse(aws) : null,
      name,
      email,
      signing,
      region: process.env.ORBISA_AWS_REGION ?? "us-east-2",
    }),
  );
  if (!aws) report("AWS session unavailable; GitHub and Codex are ready.");
}

// Credentials are sent through private stdin, stored in tmpfs, and refreshed on
// every wake. They never enter the clean image, resource JSON or progress logs.
export const INSTALL_PROFILE = String.raw`
import json, os, pathlib, subprocess, sys, tempfile
p=json.load(sys.stdin)
os.umask(0o077)
home=pathlib.Path.home()
root=pathlib.Path('/dev/shm/orbisa'); root.mkdir(mode=0o700,exist_ok=True)
os.chmod(root,0o700)
def write(path,content,mode=0o600):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(dir=path.parent)
 try:
  with os.fdopen(fd,'w') as f: f.write(content)
  os.chmod(tmp,mode); os.replace(tmp,path)
 finally:
  if os.path.exists(tmp): os.unlink(tmp)
def link(path,target):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.unlink(missing_ok=True); path.symlink_to(target)
write(root/'codex-auth.json',p['auth'])
write(root/'github-token',p['github'])
for name in ('.codex','.codex_work'): link(home/name/'auth.json',root/'codex-auth.json')
write(root/'npmrc','//npm.pkg.github.com/:_authToken='+p['github']+'\n')
link(home/'.npmrc',root/'npmrc')
if p['aws']:
 a=p['aws']
 write(root/'credentials','[default]\naws_access_key_id = '+a['AccessKeyId']+'\naws_secret_access_key = '+a['SecretAccessKey']+'\naws_session_token = '+a.get('SessionToken','')+'\n')
 link(home/'.aws/credentials',root/'credentials')
 write(home/'.aws/config','[default]\nregion = '+p['region']+'\n')
else:
 (root/'credentials').unlink(missing_ok=True)
 (home/'.aws/credentials').unlink(missing_ok=True)
helper=pathlib.Path('/usr/local/bin/orbisa-git-credential')
write(helper,'''#!/usr/bin/python3
import pathlib,sys
if len(sys.argv)>1 and sys.argv[1]=="get":
 fields=dict(line.rstrip("\\n").split("=",1) for line in sys.stdin if "=" in line)
 if fields.get("host")=="github.com" and fields.get("protocol")=="https":
  print("username=x-access-token\\npassword="+pathlib.Path("/dev/shm/orbisa/github-token").read_text()+"\\n")
''',0o700)
if pathlib.Path('/usr/bin/gh').exists(): write(pathlib.Path('/usr/local/bin/gh'),'''#!/usr/bin/python3
import os,pathlib
os.environ['GH_TOKEN']=pathlib.Path('/dev/shm/orbisa/github-token').read_text().strip()
os.execv('/usr/bin/gh',['gh',*__import__('sys').argv[1:]])
''',0o700)
def git(key,value): subprocess.run(['git','config','--global','--replace-all',key,value],check=True)
git('credential.helper',str(helper))
git('url.https://github.com/.insteadOf','git@github.com:')
subprocess.run(['git','config','--global','--add','url.https://github.com/.insteadOf','ssh://git@github.com/'],check=True)
for key in ['name','email']:
 if p[key]: git('user.'+key,p[key])
git('rerere.enabled','true')
if p['signing']:
 write(root/'signing_key',p['signing']); git('gpg.format','ssh'); git('user.signingkey',str(root/'signing_key')); git('commit.gpgsign','true')
else:
 (root/'signing_key').unlink(missing_ok=True); git('commit.gpgsign','false')
`;
