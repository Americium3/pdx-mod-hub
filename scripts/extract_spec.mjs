// One-off: split the design-review workflow result JSON into docs/ files.
import fs from 'node:fs'

const [, , src] = process.argv
const raw = JSON.parse(fs.readFileSync(src, 'utf8'))
const result = raw.result ?? raw
const final = result.final ?? {}

fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync('docs/DESIGN_SPEC.md', `# PDX Mod Hub — Design Spec (Ground Station)\n\n${final.designSpec ?? ''}\n`)
fs.writeFileSync('docs/API_AMENDMENTS.md', `# API / Architecture Amendments (from adversarial review)\n\n${final.apiAmendments ?? ''}\n`)
const mustFix = (final.mustFix ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')
fs.writeFileSync(
  'docs/BUILD_CHECKLIST.md',
  `# Build Checklist\n\n${final.buildChecklist ?? ''}\n\n## Must-fix before v1\n\n${mustFix}\n\n## Judge verdicts\n\n${(result.judges ?? [])
    .map(j => `- winner: ${j.winner} — ${j.reasoning}`)
    .join('\n')}\n`,
)
console.log('designSpec chars:', (final.designSpec ?? '').length)
console.log('apiAmendments chars:', (final.apiAmendments ?? '').length)
console.log('buildChecklist chars:', (final.buildChecklist ?? '').length)
console.log('mustFix items:', (final.mustFix ?? []).length)
