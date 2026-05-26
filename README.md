# GrapeScrape
Scrape and alert to new wine additions at selected retailers.

## How to use
GrapeScrape is designed to work either locally or as an AWS Lambda function.

- `npm run local` - run locally and print a table of results
- `npm run local:test` - run locally with stubbed data
- `npm run lambda` - run as an AWS Lambda function and publish results to an SNS topic

## Environment variables
* SNS_TOPIC_ARN - the SNS topic to publish results to
* STORE_BUCKET - the S3 bucket to store results
* STORE_KEY - the S3 key to store results