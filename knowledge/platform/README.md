# Infrastruct platform knowledge packs

This directory is for **controlled machine-readable rule packs**, not copied standards.

## Rules

- Do not commit copyrighted Australian Standards, licensed publications, or client documents unless Infrastruct has the legal right to store and redistribute them.
- Prefer a short encoded requirement plus the authoritative source reference, revision, effective date, clause/page and a link to the governing source.
- A rule is never a substitute for engineering judgement where the source leaves design/context to a competent person.
- If context is insufficient, design the rule so the evaluator returns **Needs context**, not an assumed pass.
- Platform packs are stored under the reserved owner `__infrastruct_platform__` and are read-only to customer organisations.
- Customer/project/client/asset-specific rules remain tenant-owned and are managed through Admin → Civil Knowledge.

## Import

Draft import:

```
npm run knowledge:import-platform -- knowledge/platform/example.synthetic.json
```

Activation requires an explicit flag **and** `"verified": true` in the pack file:

```
npm run knowledge:import-platform -- knowledge/platform/<approved-pack>.json --activate
```

The importer is transactional and rerunnable. It updates matching pack/source/rule records but never deletes omitted rules automatically.

## Expected JSON shape

See `example.synthetic.json`. The example is synthetic test data only and is not a construction requirement.
