# ActionMind 70-case Evaluation Report

- runAt: 2026-10-04T12:45:26.961Z
- totalCases: 70

## Understanding（20 cases，真实 LLM）
| 指标 | 值 |
| --- | --- |
| Intent Accuracy | 0.9000 |
| Entity Accuracy | 1.0000 |
| Time Accuracy | 1.0000 |

## Contact Resolution（15 cases）
| 指标 | 值 |
| --- | --- |
| Resolution Accuracy | 1.0000 |
| Ambiguity Detection Accuracy | 1.0000 |

## Memory Retrieval（20 queries × Recall@5 / MRR@5）
| Channel | Recall@5 | MRR@5 |
| --- | --- | --- |
| BM25 | 0.9750 | 0.9750 |
| Embedding | 0.9750 | 0.9667 |
| Hybrid | 0.9750 | 0.9667 |

## Tool Safety（15 cases）
| 指标 | 值 |
| --- | --- |
| Unauthorized Execution Rate | 0.0000 |
| Verified Memory Precision | 1.0000 |