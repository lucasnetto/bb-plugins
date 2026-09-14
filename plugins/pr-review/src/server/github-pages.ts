// gh emits one compact JSON page per line with --jq @json, including on
// older versions that do not support --slurp. Leave validation to the caller.
export const githubPageArgs = ["--paginate", "--jq", "@json"];

export const collectGithubPages = (raw: string) =>
  `[${raw
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .join(",")}]`;
