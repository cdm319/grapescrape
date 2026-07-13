# Wine assessor rollout validation

## Purpose

Validate a production rollout of the `grapescrape-wine-assessor` Lambda and its SQS event source mapping. The assessor consumes `AssessmentRequested` messages, calls OpenAI, and writes completed assessments to DynamoDB.

## Use this when

- Deploying assessor infrastructure changes.
- Changing the event source mapping, queue settings, OpenAI environment variables, model settings, or assessment persistence.
- Diagnosing stuck or failed assessment processing.

## Safety notes

> [!WARNING]
> Do not casually use `aws sqs receive-message` to inspect queue contents. Receiving a message increments its receive count and applies the visibility timeout. Repeated peeking can move a valid message to the DLQ.

- Prefer queue counts, Lambda logs, CloudWatch metrics, and DynamoDB queries.
- Do not purge queues, delete messages, or mutate DynamoDB from this runbook.
- OpenAI API cost is not included in AWS Cost Explorer; check it separately.

## Prerequisites

- AWS CLI authenticated to the correct production account.
- Runtime AWS region: `eu-west-2`.
- Cost Explorer region, if used: `us-east-1`.
- A configured local AWS profile. Commands intentionally do not override it.
- Repository dependencies installed. Run CDK commands from the repository root.

## Set shell variables

```bash
REGION=eu-west-2
USER_ID="5682e224-80d1-7027-767b-0617ac74683f"
ASSESSMENT_QUEUE_URL=$(aws sqs get-queue-url \
  --queue-name grapescrape-assessment-queue \
  --region "$REGION" \
  --query QueueUrl \
  --output text)
DLQ_URL=$(aws sqs get-queue-url \
  --queue-name grapescrape-assessment-dlq \
  --region "$REGION" \
  --query QueueUrl \
  --output text)
```

Expected: both URL variables contain an `https://sqs.eu-west-2.amazonaws.com/...` URL, not `None` or an error.

## Pre-deploy checks

### 1. Record the queue baseline

```bash
aws sqs get-queue-attributes \
  --queue-url "$ASSESSMENT_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --region "$REGION" \
  --query Attributes \
  --output table

aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --region "$REGION" \
  --query Attributes \
  --output table
```

Expected: the DLQ is empty. Record any visible or in-flight assessment messages; they may be processed as soon as the event source mapping becomes active.

### 2. Verify the OpenAI secret exists

```bash
aws secretsmanager describe-secret \
  --secret-id grapescrape/openai-api-key \
  --region "$REGION" \
  --query '{Name:Name,ARN:ARN,LastChangedDate:LastChangedDate}' \
  --output table
```

Expected: metadata for `grapescrape/openai-api-key`. This command does not reveal the secret value.

### 3. Synthesize and review the deployment

```bash
npm run cdk:synth
npm run cdk:diff
```

Expected: synth succeeds. In the diff, confirm:

- `grapescrape-wine-assessor` Lambda is added or updated.
- Its SQS event source mapping is added or updated.
- Batch size is `10`.
- Partial batch failure reporting is enabled as `ReportBatchItemFailures`.
- Lambda timeout is `600` seconds.
- Reserved concurrency is `1`.
- The expected environment variables are present:
  - `ASSESSMENTS_TABLE_NAME=grapescrape-assessments`
  - `USER_DATA_TABLE_NAME=grapescrape-user-data`
  - `DEFAULT_USER_ID=5682e224-80d1-7027-767b-0617ac74683f`
  - `OPENAI_API_KEY_NAME=grapescrape/openai-api-key`
  - `OPENAI_MODEL=gpt-5.6-terra`
  - `OPENAI_REASONING_EFFORT=medium`
  - `OPENAI_TEXT_VERBOSITY=medium`
- There is no unexpected replacement of DynamoDB tables, queues, Cognito, the scheduler, or unrelated resources.

Stop and investigate any unexpected replacement or unrelated change before deploying.

## Deploy

> [!WARNING]
> If the assessment queue has visible messages, OpenAI-backed processing may start—and incur cost—as soon as the event source mapping becomes active.

```bash
npm run cdk:deploy
```

Expected: CloudFormation completes successfully. Do not continue if the deployment rolls back or leaves resources in a failed state.

## Runtime validation

### 1. Check the Lambda configuration

```bash
aws lambda get-function-configuration \
  --function-name grapescrape-wine-assessor \
  --region "$REGION" \
  --query '{State:State,LastUpdateStatus:LastUpdateStatus,Runtime:Runtime,Timeout:Timeout,ReservedConcurrency:ReservedConcurrentExecutions,Environment:Environment.Variables}' \
  --output json
```

Expected: `State` is `Active`, `LastUpdateStatus` is `Successful`, timeout is `600`, reserved concurrency is `1`, and the environment matches the reviewed defaults.

### 2. Check the event source mapping

```bash
aws lambda list-event-source-mappings \
  --function-name grapescrape-wine-assessor \
  --region "$REGION" \
  --query 'EventSourceMappings[].{UUID:UUID,State:State,LastProcessingResult:LastProcessingResult,EventSourceArn:EventSourceArn,BatchSize:BatchSize,FunctionResponseTypes:FunctionResponseTypes}' \
  --output json
```

Expected: the mapping for `grapescrape-assessment-queue` is `Enabled`, batch size is `10`, and `FunctionResponseTypes` contains `ReportBatchItemFailures`.

### 3. Follow assessor logs

```bash
aws logs tail /aws/lambda/grapescrape-wine-assessor \
  --since 30m \
  --follow \
  --format short \
  --region "$REGION"
```

Stop following with `Ctrl-C` after processing completes. Expected successful patterns include:

```text
GrapeScrape wine assessor starting with ... records.
Sent wine ... to OpenAI for assessment.
Received assessment for wine ... from OpenAI.
Completed assessment for requestId=... assessmentInputKey=...
GrapeScrape wine assessor finished with 0 failed records.
```

SQS batch size is a maximum, not a guarantee; an invocation may contain fewer than 10 messages.

### 4. Confirm both queues settle

```bash
aws sqs get-queue-attributes \
  --queue-url "$ASSESSMENT_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --region "$REGION" \
  --query Attributes \
  --output table

aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --region "$REGION" \
  --query Attributes \
  --output table
```

Expected after processing: all counts are `0`. SQS counts are approximate; recheck after a short wait before treating a single non-zero result as a failure.

## DynamoDB validation

Query the newest completed assessments for the default user through `GSI1`:

```bash
aws dynamodb query \
  --table-name grapescrape-assessments \
  --index-name GSI1 \
  --key-condition-expression 'gsi1pk = :gsi1pk' \
  --expression-attribute-values '{":gsi1pk":{"S":"USER#'"$USER_ID"'#ASSESSMENTS"}}' \
  --no-scan-index-forward \
  --limit 20 \
  --region "$REGION" \
  --query 'Items[].{completedAt:completedAt.S,createdAt:createdAt.S,wineId:wineId.S,name:wineSnapshot.M.name.S,fit:fit.S,confidence:confidence.S,highlight:highlight.BOOL,model:model.S}' \
  --output table
```

Expected: recent rows have a completion or creation timestamp, wine details, assessment fields, and model `gpt-5.6-terra`. GSI results are eventually consistent, so wait briefly and retry if logs show completion but a new row is not yet visible.

## Steady-state validation

After the next scheduled retailer scrape, confirm:

- No unexpected assessor failures appear in the logs or Lambda metrics.
- The assessment queue returns to empty.
- The DLQ remains empty.
- Already-assessed wines do not churn through repeated assessments unless the source hash, palate profile version, assessment version, or forced reassessment changes.

## Troubleshooting

### Queue is not draining

**Likely meaning:** processing is slower than arrivals, invocations are failing, or the mapping is unhealthy.

**First check:** rerun the event source mapping check, then tail the assessor logs.

**Safest next action:** if the mapping is enabled, use the first logged failure to diagnose the dependency or data issue. Do not purge or manually receive messages.

### Messages are visible but Lambda is not processing

**Likely meaning:** the event source mapping is disabled or not attached to the expected queue, the Lambda is inactive, or concurrency is unavailable.

**First check:** run `aws lambda list-event-source-mappings --function-name grapescrape-wine-assessor --region "$REGION"`.

**Safest next action:** verify the mapping, function state, and reserved concurrency against the runtime checks. Correct the deployment rather than consuming messages manually.

### Messages are not visible but no completed assessments exist

**Likely meaning:** messages are in flight, or an invocation received them and is retrying after failure.

**First check:** inspect `ApproximateNumberOfMessagesNotVisible`, then tail the Lambda logs.

**Safest next action:** allow the invocation or 12-minute visibility timeout to finish. Follow retries in logs and watch the DLQ; do not enqueue duplicates.

### DLQ has messages

**Likely meaning:** one or more messages failed processing five times.

**First check:** tail the assessor logs and identify the repeated failure before the messages reached the DLQ.

**Safest next action:** preserve the DLQ messages, fix the root cause, and use a separately reviewed redrive procedure. Do not inspect them with repeated `receive-message` calls.

### Secret not found

**Likely meaning:** the secret is absent in `eu-west-2`, has a different name, or the caller lacks permission to describe it.

**First check:** rerun `aws secretsmanager describe-secret --secret-id grapescrape/openai-api-key --region "$REGION"` and read the exact error.

**Safest next action:** confirm the intended secret name and account. Restore access or the expected secret through the approved secrets process; never print the secret value into logs or the terminal history.

### OpenAI or API errors

**Likely meaning:** invalid credentials, rate or quota limits, model access, request validation, or a transient provider error.

**First check:** tail the assessor logs and capture the error type, request ID, and HTTP status without exposing credentials.

**Safest next action:** verify the Lambda environment and secret metadata, then check OpenAI account usage/status separately. Resolve persistent errors before redriving failed work.

### Completed assessments are missing from DynamoDB

**Likely meaning:** processing did not reach the conditional write, the query is for the wrong user or region, or the GSI has not propagated yet.

**First check:** rerun the `GSI1` query and look for the matching `Completed assessment for requestId=...` log entry.

**Safest next action:** verify `ASSESSMENTS_TABLE_NAME`, `USER_ID`, and region from the Lambda configuration. Wait briefly for GSI propagation; do not write a replacement row manually.

### Receives look duplicated after manually peeking at SQS

**Likely meaning:** `receive-message` made messages temporarily invisible and incremented their receive counts; Lambda or later peeks can receive them again after the visibility timeout.

**First check:** inspect visible, not-visible, and DLQ counts with `get-queue-attributes`.

**Safest next action:** stop peeking, wait at least the 12-minute visibility timeout, and monitor logs and counts. Do not delete messages or keep receiving them to make them visible.

## Optional cost check

Set UTC date boundaries using the repository's Node.js runtime:

```bash
COST_START=$(node -e 'const d=new Date(); process.stdout.write(`${d.toISOString().slice(0,7)}-01`)')
COST_END=$(node -e 'process.stdout.write(new Date(Date.now()+86400000).toISOString().slice(0,10))')
FORECAST_START=$(date -u +%Y-%m-%d)
FORECAST_END=$(node -e 'const d=new Date(); process.stdout.write(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,10))')
```

Month-to-date AWS spend by service:

```bash
aws ce get-cost-and-usage \
  --time-period Start="$COST_START",End="$COST_END" \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region us-east-1 \
  --query 'ResultsByTime[].Groups[].{Service:Keys[0],Amount:Metrics.UnblendedCost.Amount,Unit:Metrics.UnblendedCost.Unit}' \
  --output table
```

AWS forecast to the start of next month:

```bash
aws ce get-cost-forecast \
  --time-period Start="$FORECAST_START",End="$FORECAST_END" \
  --metric UNBLENDED_COST \
  --granularity MONTHLY \
  --region us-east-1 \
  --query Total \
  --output table
```

OpenAI API usage is not included in either result; check it in the OpenAI usage dashboard.
