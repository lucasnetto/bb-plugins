import { GithubMarkdown } from "../components/GithubMarkdown";

export function ReviewCommentBody({ content }: { content: string }) {
  return (
    <GithubMarkdown
      className="min-w-0 max-w-full overflow-x-auto font-sans text-sm whitespace-normal [overflow-wrap:anywhere]"
      content={content}
    />
  );
}
