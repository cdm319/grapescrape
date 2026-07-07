# 🍇 GrapeScrape

**GrapeScrape** is an AWS Lambda-based scraper for wine data for selected retailers. It has the following functionality:

- Scrape in-stock wines from supported retailers.
- Send wines to a custom OpenAI agent for assessment against a given palate model.
- Save wines and assessments to storage.
- Alert users to new wines of interest.



# 📐 Architecture
## Old
GrapeScrape is designed to run on **AWS** (it can also be run locally for test purposes).

Currently, it utilises **Lambda** to execute the function, **S3** for simple JSON storage, **SNS** for alerts, **Secrets Manager** for sensitive data (e.g. API Keys), and **EventBridge Scheduler** to manage scheduled running of the function.

<img alt="Image" src="https://github.com/user-attachments/assets/79ab22c0-a637-45aa-bdc5-860218636d7f" />

Infrastructure is managed and deployed via the AWS CDK and GitHub Actions.

## Future
GrapeScrape is currently being migrated to an event-driven architecture, with independent Lambda functions, queues, DynamoDB-based storage and a UI layer for user interaction.

<img alt="Future Architecture" src="https://private-user-images.githubusercontent.com/2217666/618465555-5d6e0574-3b9b-4952-ae80-570b76c763ed.png?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3ODM0NTkxMzMsIm5iZiI6MTc4MzQ1ODgzMywicGF0aCI6Ii8yMjE3NjY2LzYxODQ2NTU1NS01ZDZlMDU3NC0zYjliLTQ5NTItYWU4MC01NzBiNzZjNzYzZWQucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI2MDcwNyUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNjA3MDdUMjExMzUzWiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9Y2QyMzA1ZGI1ZWY4YzkxZjE0YzNiZDAzNmNhYjM1ZTY3NmE0NjUyMzk1N2QzODQzNzM2YmUyNDY5ZTAzNmRlYiZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QmcmVzcG9uc2UtY29udGVudC10eXBlPWltYWdlJTJGcG5nIn0.QiYRKNGf-0qMv_2kKfO3Q-MPUq-Ot1hcQtJh8Soe4cY" />