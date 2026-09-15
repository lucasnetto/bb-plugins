import { Avatar } from "../workspace/presentation";

export function CommentAvatar({ login }: { login?: string }) {
  return (
    <span className="size-6 shrink-0 [&>.pr-avatar]:size-6">
      <Avatar
        actor={
          login
            ? { login, avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=48` }
            : null
        }
      />
    </span>
  );
}
