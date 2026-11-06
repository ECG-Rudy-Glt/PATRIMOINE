# Contexte de build : racine du dépôt (pour embarquer db/migrations)
FROM python:3.12-slim
WORKDIR /srv
COPY services/ledger/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/ledger/app app
COPY db/migrations migrations
USER 1000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
