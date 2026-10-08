# TASTE.md decision record format

Record decisions whose reasoning is useful to future engineers, using a contextual triple. Routine mechanical changes do not require a new entry. Timestamps use Asia/Shanghai (UTC+08:00).

```yaml
- timestamp: "YYYY-MM-DD HH:MM:SS"
  confidence_score: 0.0
  source_event: "Evidence or request that triggered the decision"
  contextual_triple:
    context: "Specific situation requiring judgment"
    action_judgment: "Engineering decision and its rationale"
    feedback_result: "Observed result and remaining validation boundaries"
  potential_ontology_impact: "Affected concept or validation rule"
```
