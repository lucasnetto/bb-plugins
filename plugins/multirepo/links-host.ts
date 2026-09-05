import { join } from 'node:path';
import { z } from 'zod';
import { command, discover } from './git';
import { linkedContentsInput, parsePrUrl, prSummarySchema } from './links-contract';
const viewSchema = z.object({ title: z.string(), state: z.enum(['OPEN','CLOSED','MERGED']), isDraft: z.boolean(), body: z.string(), headRefName: z.string(), baseRefName: z.string(), baseRefOid:z.string(), headRefOid:z.string() });
async function view(root: string, url: string, signal?: AbortSignal) {
  const ref = parsePrUrl(url);
  const data = viewSchema.parse(JSON.parse(await command(root, 'gh', ['pr', 'view', ref.url, '--json', 'title,state,isDraft,body,headRefName,baseRefName,baseRefOid,headRefOid'], signal)));
  return { pr: prSummarySchema.parse({ ...ref, ...data }), data };
}
export async function linkedSummary(root: string, url: string, signal?: AbortSignal) {
  return (await view(root, url, signal)).pr;
}
export async function linkedDetail(root: string, url: string, signal?: AbortSignal) {
  const ref = parsePrUrl(url);
  const [{ pr, data }, rawFiles, repos] = await Promise.all([
    view(root, url, signal),
    command(root, 'gh', ['api', '--hostname', 'github.com', '--paginate', '--slurp', `repos/${ref.repository}/pulls/${ref.number}/files`], signal),
    discover(root, signal).catch(() => []),
  ]);
  const files = z.array(z.array(z.object({ filename: z.string(), patch: z.string().optional(), status: z.string(), previous_filename: z.string().optional() }))).parse(JSON.parse(rawFiles)).flat();
  const matches = repos.filter(r => r.remote?.toLowerCase() === ref.repository);
  return { pr, body: data.body, headRefName: data.headRefName, baseRefName: data.baseRefName,
    baseRefOid:data.baseRefOid, headRefOid:data.headRefOid,
    repositoryRoot: matches.length === 1 ? join(root, matches[0].name) : null,
    files: files.map(f => ({ path: f.filename, patch: f.patch ?? null, status: f.status, ...(f.previous_filename ? {previousPath:f.previous_filename} : {}) })) };
}

// Read immutable GitHub revisions, not files from the agent's working tree.
export async function linkedContents(root:string, input:z.infer<typeof linkedContentsInput>, signal?:AbortSignal, run = command) {
  const {repository} = parsePrUrl(input.url);
  const api = (path:string, extra:string[] = []) => run(root, 'gh', ['api','--hostname','github.com', ...extra, path], signal);
  const comparison = z.object({merge_base_commit:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)})}).parse(JSON.parse(await api(`repos/${repository}/compare/${input.base}...${input.head}`)));
  const read = async (path:string, sha:string) => {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const contents = await api(`repos/${repository}/contents/${encoded}?ref=${sha}`, ['-H','Accept: application/vnd.github.raw+json']);
    if (contents.includes('\0')) throw new Error('Cannot expand binary file context. Open the file on GitHub.');
    return contents;
  };
  const [oldContents,newContents] = await Promise.all([
    input.changeType === 'new' ? '' : read(input.oldPath, comparison.merge_base_commit.sha),
    input.changeType === 'deleted' ? '' : read(input.path,input.head),
  ]);
  return {oldContents,newContents};
}
