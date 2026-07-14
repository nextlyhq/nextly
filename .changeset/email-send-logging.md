---
"nextly": patch
---

Emit a consistent, greppable log record for every email send. Successful sends log an `email.sent` event and failures an `email.failed` event, each carrying the recipient, subject, provider type, duration, and (on success) the provider message id or (on failure) the error. This gives self-hosted deployments useful send observability from their existing logs and log aggregator without persisting recipient data in the application database.
