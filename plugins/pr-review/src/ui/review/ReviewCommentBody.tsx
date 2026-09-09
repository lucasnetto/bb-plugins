import { Markdown } from "@get-bb/plugin-sdk/app";

export function ReviewCommentBody({ content }: { content: string }) {
  return (
    <Markdown
      className="min-w-0 max-w-full overflow-x-auto font-sans text-sm whitespace-normal [overflow-wrap:anywhere]"
      content={content}
    />
  );
}
