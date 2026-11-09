# Website check Lambda

`index.mjs` checks a public HTTP/HTTPS URL and writes each result to DynamoDB before returning it.

## AWS configuration

- Runtime: Node.js 24.x; handler: `index.handler`.
- Timeout: 10 seconds.
- Table: `cloudpulse-checks` in the same region, with String partition key `url` and String sort key `checkId`.
- Optional environment variable: `CHECKS_TABLE` overrides the table name.
- Execution role: allow `dynamodb:PutItem` only on this table, in addition to logging permissions.
- Uses `@aws-sdk/client-dynamodb` supplied by the Lambda Node.js runtime. Local unit tests inject the save operation and need no SDK installation.

A successful write returns `historySaved: true` and a timestamp/UUID `checkId`. A failed write returns HTTP 503 with `historySaved: false`; it does not change the measured website status to an outage. History is not yet displayed in the dashboard. Each invocation creates a record; no retention cleanup is configured yet.

## Tests

From the repository root:

```sh
node --test lambda/index.test.mjs
```

Git commits do not deploy automatically. Update the Lambda code in AWS separately.
