FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY service/ ./service/
COPY web/ ./web/
EXPOSE 5175
# --app-dir puts service/ on sys.path so the modules' bare imports
# (import core_client, from db import get_db, ...) resolve without needing
# them repackaged as service.* -- matches how they were built and verified.
CMD ["uvicorn", "app:app", "--app-dir", "/app/service", "--host", "0.0.0.0", "--port", "5175"]
