// Guide shape adapted from Plannotator (see ../PLANNOTATOR-LICENSE).
import { Schema } from "effect";
import type { LinkedDetail } from "./links-contract";

const prose = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(12000));

const path = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));

export const guideSchema = Schema.Struct({
  title: prose,
  intent: prose,
  sections: Schema.Array(
    Schema.Struct({
      title: prose,
      overview: prose,
      diffs: Schema.Array(Schema.Struct({ file: path, summary: prose })).check(
        Schema.isMaxLength(3000),
      ),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
  unplacedFiles: Schema.Array(path).check(Schema.isMaxLength(3000)),
});

export interface ReviewGuide extends Schema.Schema.Type<typeof guideSchema> {}

export const guideTarget = Schema.Struct({ threadId: Schema.String, url: Schema.String });

export const guideRevision = Schema.Struct({
  base: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  head: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
});

export const savedGuideSchema = Schema.Struct({
  id: Schema.String,
  ...guideRevision.fields,
  guide: guideSchema,
  reviewed: Schema.Array(Schema.Boolean),
});

export interface SavedGuide extends Schema.Schema.Type<typeof savedGuideSchema> {}

export const guideProgressInput = Schema.Struct({
  ...guideTarget.fields,
  id: Schema.String,
  chapter: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  reviewed: Schema.Boolean,
});

export const GUIDE_CHANGED = "review-guide-changed";

export function guideChapters(guide: ReviewGuide) {
  return [
    ...guide.sections,
    ...(guide.unplacedFiles.length
      ? [
          {
            title: "Everything else",
            overview:
              "These changed files were not placed in a chapter. Review them before finishing.",
            diffs: guide.unplacedFiles.map((file) => ({
              file,
              summary: "Additional changed file.",
            })),
          },
        ]
      : []),
  ];
}

export function validateGuideCoverage(guide: ReviewGuide, files: LinkedDetail["files"]) {
  const expected = new Set(files.map((file) => file.path));
  const seen = new Set<string>();

  for (const file of [
    ...guide.sections.flatMap((section) => section.diffs.map((diff) => diff.file)),
    ...guide.unplacedFiles,
  ]) {
    if (!expected.has(file)) throw new Error(`Guide references a file outside this PR: ${file}`);

    if (seen.has(file)) throw new Error(`Guide references a file twice: ${file}`);
    seen.add(file);
  }

  const missing = [...expected].filter((file) => !seen.has(file));

  if (missing.length) throw new Error(`Guide omits changed files: ${missing.join(", ")}`);
}
