# Chart extraction corpus

Synthetic chart screenshots with golden labels. `recorded/mock/` holds hand-authored, deliberately imperfect
recordings used by the MockExtractor. They are NOT model output. Real accuracy requires `npm run corpus:record`
(Anthropic credentials; manual only), which writes `recorded/claude/`.
