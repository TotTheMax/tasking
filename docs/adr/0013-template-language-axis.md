# Template language is an axis separate from workflow variant

Bilingual starter templates (TAS-19) could double the `--workflow` enum (`grill-openspec-en`, …) or add a new flag. We decided language selection is orthogonal to the variant: a `--lang <zh|en>` choice that composes with any of the three variants, so the variant keeps sole ownership of the installed skill set and sentinel detection, and the matrix stays 3 × 2 instead of 6 flat values. The zh templates remain untouched as the canonical default (`--lang` defaults to zh; interactive init prompts); English templates are three new parallel files carrying a top-of-file `<!-- tasking-workflow-lang: en -->` sentinel so `init --update` drift-reports against the matching language (mirroring `detectWorkflow`; zh is detected by absence). Protocol sentinels (`<!-- tasking-workflow: code-mr -->`, `## 🔍 拷问 / Grill Questions`) stay byte-identical across languages.

Status: accepted — confirmed by product on TAS-19 ("都按推荐的来").

