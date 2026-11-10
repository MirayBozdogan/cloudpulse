# Website check Lambda

`index.mjs` checks a public HTTP/HTTPS URL and writes each result to DynamoDB before returning it.

## AWS configuration

- Runtime: Node.js 24.x; handler: `index.handler`.
- Timeout: 10 seconds.
- Table: `cloudpulse-checks` in the same region, with String partition key `url` and String sort key `checkId`.
- Optional environment variable: `CHECKS_TABLE` overrides the table name.
- Execution role: allow `dynamodb:PutItem` only on this table, in addition to logging permissions.
- Uses `@aws-sdk/client-dynamodb` supplied by the Lambda Node.js runtime. Local unit tests inject the save operation and need no SDK installation.

A successful write returns `historySaved: true` and a timestamp/UUID `checkId`. A failed write returns HTTP 503 with `historySaved: false`; it does not change the measured website status to an outage. The dashboard can request the latest 20 records for one exact URL with `?action=history&url=...`. Reading history does not run or save a new check. This requires the additional table-scoped `dynamodb:Query` permission in `history-read-policy.json`. The public Function URL does not provide user isolation: anyone knowing a monitored URL can request its projected check history once deployed. No full-table scan or list of monitored URLs is exposed. Each invocation creates a record; no retention cleanup is configured yet.

## Tests

From the repository root:

```sh
node --test app.test.cjs lambda/index.test.mjs
```

Git commits do not deploy automatically. Update the Lambda code in AWS separately.
