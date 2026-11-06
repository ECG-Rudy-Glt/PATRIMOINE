FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app app
USER 1000
# Connecteur par défaut : Enable Banking. Powens : `python -m app.powens`
# API « Banques » (Deployment bank-api) : uvicorn app.api:app --no-access-log
CMD ["python", "-m", "app.enablebanking", "sync"]
