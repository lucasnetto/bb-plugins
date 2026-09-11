import { memo } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import "./github-markdown.css";

const remarkPlugins = [remarkGfm];
// GitHub bodies include HTML (bot badges, details, superscripts). Parse it
// before sanitizing so comments disappear and only safe elements reach React.
const rehypePlugins = [rehypeRaw, rehypeSanitize];
const components: Components = {
  a: ({ node: _node, href, ...props }) =>
    href ? <UrlLink {...props} href={href} /> : <a {...props} />,
};

export const GithubMarkdown = memo(function GithubMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={["pr-markdown", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
