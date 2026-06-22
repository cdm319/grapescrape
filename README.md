# 🍇 GrapeScrape

**GrapeScrape** is an AWS Lambda-based scraper for wine data for selected retailers. It has the following functionality:

- Scrape in-stock wines from supported retailers.
- Send wines to a custom OpenAI agent for assessment against a given palate model.
- Save wines and assessments to storage.
- Alert users to new wines of interest.



# 📐 Architecture
GrapeScrape is designed to run on **AWS** (it can also be run locally for test purposes).

Currently, it utilises **Lambda** to execute the function, **S3** for simple JSON storage, **SNS** for alerts, **Secrets Manager** for sensitive data (e.g. API Keys), and **EventBridge Scheduler** to manage scheduled running of the function.

<img alt="Image" src="https://github.com/user-attachments/assets/79ab22c0-a637-45aa-bdc5-860218636d7f" />

Infrastructure is managed and deployed via the AWS CDK and GitHub Actions.
